import { randomUUID } from "node:crypto";
import { resolveAgentFromRequest } from "@/lib/agent-service";
import { isBlockKeyAllowedForCategory } from "@/lib/dashboard/block-key-policy";
import {
  decryptBlockPayload,
  encryptBlockPayload,
} from "@/lib/dashboard/crypto";
import {
  assertCategoryAllowedForToken,
  assertSectionOwnedByAgent,
} from "@/lib/dashboard/logic";
import { containsSingaporeNricOrFin } from "@/lib/dashboard/nric-guard";
import { parseDashboardBlockPayload } from "@/lib/dashboard/parse-payload";
import { assertSensitiveCategoryWritable } from "@/lib/dashboard/sensitive-exclusivity";
import type {
  DashboardBlockPublic,
  DashboardBlockRow,
  DashboardSectionRow,
} from "@/lib/dashboard/types";
import {
  dashboardBlockKeyConflictResponse,
  dashboardInvalidPayloadResponse,
} from "@/lib/dashboard/write-errors";
import { jsonError, jsonOkNoStore } from "@/lib/http";
import {
  isPgForbidden,
  isPgNotFound,
} from "@/lib/pg-errors";
import { getServiceClient } from "@/lib/supabase/server";
import { upsertDashboardBlockSchema } from "@/lib/validation";
import { requireRequest } from "@/lib/require-request";

type RouteContext = {
  params: Promise<{ id: string; block_key: string }>;
};

function toPublicBlock(row: DashboardBlockRow): DashboardBlockPublic {
  const decrypted = decryptBlockPayload(row);
  return {
    id: row.id,
    section_id: row.section_id,
    block_type: row.block_type,
    sort_order: row.sort_order,
    agent_id: row.agent_id,
    payload: decrypted.payload,
    created_at: row.created_at,
    updated_at: row.updated_at,
    decrypt_failed: decrypted.decrypt_failed,
  };
}

/**
 * PUT /api/agent/dashboard/sections/:id/blocks/:block_key
 * Upsert by (section_id, block_key): replace payload if exists, else create.
 * Auth, category allow-list, validation, and rate limits match other write routes.
 */
export async function PUT(request: Request, context: RouteContext) {
  await requireRequest();
  const { id: sectionId, block_key: blockKeyParam } = await context.params;
  const blockKey = decodeURIComponent(blockKeyParam);

  const supabase = getServiceClient();
  const auth = await resolveAgentFromRequest(
    supabase,
    request.headers.get("authorization"),
  );
  if (!auth.ok) {
    return jsonError(auth.status, auth.error, {
      retryAfterSeconds: auth.retryAfterSeconds,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  if (containsSingaporeNricOrFin(body)) {
    return dashboardInvalidPayloadResponse();
  }

  const parsed = upsertDashboardBlockSchema.safeParse(body);
  if (!parsed.success) {
    return dashboardInvalidPayloadResponse();
  }

  const { data: section, error: sectionError } = await supabase
    .from("dashboard_sections")
    .select("*")
    .eq("id", sectionId)
    .maybeSingle();

  if (sectionError) {
    return jsonError(500, "failed to load section");
  }
  if (!section) {
    return jsonError(404, "section not found");
  }

  const sectionRow = section as DashboardSectionRow;

  const owned = assertSectionOwnedByAgent(auth.agent.agentId, sectionRow);
  if (!owned.ok) {
    return jsonError(owned.status, owned.error);
  }

  const catAllowed = assertCategoryAllowedForToken(
    auth.agent.allowedCategories,
    sectionRow.category,
  );
  if (!catAllowed.ok) {
    return jsonError(catAllowed.status, catAllowed.error);
  }

  const writable = await assertSensitiveCategoryWritable(
    supabase,
    auth.agent.agentId,
    sectionRow.category,
    { knownSectionAgentId: sectionRow.agent_id },
  );
  if (!writable.ok) {
    return jsonError(writable.status, writable.error);
  }

  if (!isBlockKeyAllowedForCategory(sectionRow.category, blockKey)) {
    return dashboardInvalidPayloadResponse();
  }

  const payloadParsed = parseDashboardBlockPayload(
    parsed.data.block_type,
    parsed.data.payload,
    sectionRow.category,
    { requireBlockKey: blockKey },
  );
  if (!payloadParsed.ok) {
    return dashboardInvalidPayloadResponse();
  }

  // Resolve row id before encrypt so AAD matches (create vs replace).
  const { data: existingKeyRow, error: existingError } = await supabase
    .from("dashboard_blocks")
    .select("id")
    .eq("section_id", sectionId)
    .eq("block_key", blockKey)
    .maybeSingle();

  if (existingError) {
    return jsonError(500, "failed to load section blocks");
  }

  const blockId =
    existingKeyRow && typeof existingKeyRow.id === "string"
      ? existingKeyRow.id
      : randomUUID();
  const encryptedPayload = encryptBlockPayload(blockId, payloadParsed.data);

  const { data, error } = await supabase.rpc("upsert_dashboard_block_by_key", {
    p_id: blockId,
    p_section_id: sectionId,
    p_block_key: blockKey,
    p_block_type: parsed.data.block_type,
    p_sort_order: parsed.data.sort_order ?? 0,
    p_agent_id: auth.agent.agentId,
    p_payload: encryptedPayload,
  });

  if (error) {
    // Never log payload, token, or hash.
    console.error("upsert_dashboard_block_by_key failed", {
      sectionId,
      code: (error as { code?: string }).code ?? "unknown",
    });
    if ((error as { code?: string }).code === "23505") {
      return dashboardBlockKeyConflictResponse();
    }
    if (isPgForbidden(error)) {
      return jsonError(403, "forbidden");
    }
    if (isPgNotFound(error)) {
      return jsonError(404, "section not found");
    }
    return jsonError(500, "failed to upsert block");
  }

  const result = data as {
    block?: DashboardBlockRow;
    inserted?: boolean;
  } | null;

  if (!result?.block) {
    return jsonError(500, "failed to upsert block");
  }

  return jsonOkNoStore(
    { block: toPublicBlock(result.block) },
    { status: result.inserted === false ? 200 : 201 },
  );
}
