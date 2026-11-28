import { randomUUID } from "node:crypto";
import { resolveAgentFromRequest } from "@/lib/agent-service";
import { collectLegacyBlockKeyMatches } from "@/lib/dashboard/block-key";
import { isBlockKeyAllowedForCategory } from "@/lib/dashboard/block-key-policy";
import {
  decryptBlockPayload,
  encryptBlockPayload,
} from "@/lib/dashboard/crypto";
import {
  containsSingaporeNricOrFin,
  privacyOptionsForCategory,
} from "@/lib/dashboard/nric-guard";
import { parseDashboardBlockPayload } from "@/lib/dashboard/parse-payload";
import { assertAgentIsCategoryWriter } from "@/lib/dashboard/writers";
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
  isPgConflict,
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
 *
 * Legacy rows (block_key column NULL, key only inside encrypted payload): when
 * the column miss, decrypt NULL-key siblings; one match → patch + backfill
 * column; multiple → 409 without echoing content.
 */
export async function PUT(request: Request, context: RouteContext) {
  await requireRequest();
  // Next.js already percent-decodes dynamic params; do not decode again.
  const { id: sectionId, block_key: blockKey } = await context.params;

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
    return dashboardInvalidPayloadResponse(parsed.error);
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

  const travelPrivacy = privacyOptionsForCategory(sectionRow.category);
  if (
    travelPrivacy.travel &&
    containsSingaporeNricOrFin(body, travelPrivacy)
  ) {
    return dashboardInvalidPayloadResponse();
  }

  const writer = await assertAgentIsCategoryWriter(
    supabase,
    auth.agent.agentId,
    sectionRow.category,
  );
  if (!writer.ok) {
    return jsonError(writer.status, writer.error);
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
    return dashboardInvalidPayloadResponse(payloadParsed.error);
  }

  // Column hit first.
  const { data: existingKeyRow, error: existingError } = await supabase
    .from("dashboard_blocks")
    .select("id")
    .eq("section_id", sectionId)
    .eq("block_key", blockKey)
    .maybeSingle();

  if (existingError) {
    return jsonError(500, "failed to load section blocks");
  }

  let blockId: string | null =
    existingKeyRow && typeof existingKeyRow.id === "string"
      ? existingKeyRow.id
      : null;

  // Column miss → recover legacy NULL block_key rows via payload decrypt.
  if (blockId === null) {
    const { data: nullKeyRows, error: nullKeyError } = await supabase
      .from("dashboard_blocks")
      .select("id, payload")
      .eq("section_id", sectionId)
      .is("block_key", null);

    if (nullKeyError) {
      return jsonError(500, "failed to load section blocks");
    }

    const matches = collectLegacyBlockKeyMatches(
      (nullKeyRows ?? []) as Array<{ id: string; payload: string }>,
      blockKey,
    );

    if (matches.length > 1) {
      return dashboardBlockKeyConflictResponse();
    }

    if (matches.length === 1) {
      const legacyId = matches[0]!;
      const encryptedPayload = encryptBlockPayload(legacyId, payloadParsed.data);
      const touchSort = parsed.data.sort_order !== undefined;
      const { data, error } = await supabase.rpc(
        "apply_agent_dashboard_block_patch",
        {
          p_block_id: legacyId,
          p_agent_id: auth.agent.agentId,
          p_touch_block_type: true,
          p_block_type: parsed.data.block_type,
          p_touch_sort_order: touchSort,
          p_sort_order: parsed.data.sort_order ?? 0,
          p_touch_payload: true,
          p_payload: encryptedPayload,
          p_touch_block_key: true,
          p_block_key: blockKey,
        },
      );

      if (error) {
        console.error("apply_agent_dashboard_block_patch failed", {
          sectionId,
          code: (error as { code?: string }).code ?? "unknown",
        });
        if ((error as { code?: string }).code === "23505") {
          return dashboardBlockKeyConflictResponse();
        }
        if (isPgConflict(error)) {
          return jsonError(409, "conflict");
        }
        if (isPgForbidden(error)) {
          return jsonError(403, "forbidden");
        }
        if (isPgNotFound(error)) {
          return jsonError(404, "block not found");
        }
        return jsonError(500, "failed to upsert block");
      }

      const patched = data as { block?: DashboardBlockRow } | null;
      if (!patched?.block) {
        return jsonError(500, "failed to upsert block");
      }

      return jsonOkNoStore({ block: toPublicBlock(patched.block) }, { status: 200 });
    }
  }

  // No legacy match (or column hit): atomic upsert by key column.
  if (blockId === null) {
    blockId = randomUUID();
  }
  const encryptedPayload = encryptBlockPayload(blockId, payloadParsed.data);

  const { data, error } = await supabase.rpc("upsert_dashboard_block_by_key", {
    p_id: blockId,
    p_section_id: sectionId,
    p_block_key: blockKey,
    p_block_type: parsed.data.block_type,
    // Omit → NULL → SQL COALESCE preserves existing sort_order on update.
    p_sort_order: parsed.data.sort_order ?? null,
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
    // Concurrent first-write id mismatch (and other XJ409 conflicts) → 409 retry.
    if (isPgConflict(error)) {
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
