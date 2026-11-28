import { randomUUID } from "node:crypto";
import { resolveAgentFromRequest } from "@/lib/agent-service";
import {
  readPayloadBlockKey,
  sectionHasBlockKeyConflict,
} from "@/lib/dashboard/block-key";
import {
  decryptBlockPayload,
  encryptBlockPayload,
} from "@/lib/dashboard/crypto";
import { planCreateBlock } from "@/lib/dashboard/logic";
import { containsSingaporeNricOrFin } from "@/lib/dashboard/nric-guard";
import {
  earlyValidateDashboardPayload,
  parseDashboardBlockPayload,
} from "@/lib/dashboard/parse-payload";
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
  isPgForbidden,
  isPgNotFound,
} from "@/lib/pg-errors";
import { getServiceClient } from "@/lib/supabase/server";
import { createDashboardBlockSchema } from "@/lib/validation";
import { requireRequest } from "@/lib/require-request";

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

export async function POST(request: Request) {
  await requireRequest();
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

  const parsed = createDashboardBlockSchema.safeParse(body);
  if (!parsed.success) {
    return dashboardInvalidPayloadResponse();
  }

  if (
    !earlyValidateDashboardPayload(
      parsed.data.block_type,
      parsed.data.payload,
    )
  ) {
    return dashboardInvalidPayloadResponse();
  }

  const { data: section, error: sectionError } = await supabase
    .from("dashboard_sections")
    .select("*")
    .eq("id", parsed.data.section_id)
    .maybeSingle();

  if (sectionError) {
    return jsonError(500, "failed to load section");
  }
  if (!section) {
    return jsonError(404, "section not found");
  }

  const sectionRow = section as DashboardSectionRow;

  const writer = await assertAgentIsCategoryWriter(
    supabase,
    auth.agent.agentId,
    sectionRow.category,
  );
  if (!writer.ok) {
    return jsonError(writer.status, writer.error);
  }

  const payloadParsed = parseDashboardBlockPayload(
    parsed.data.block_type,
    parsed.data.payload,
    sectionRow.category,
  );
  if (!payloadParsed.ok) {
    return dashboardInvalidPayloadResponse();
  }

  const validatedPayload = payloadParsed.data;

  const planned = planCreateBlock(
    auth.agent.agentId,
    sectionRow,
    {
      section_id: parsed.data.section_id,
      block_type: parsed.data.block_type,
      sort_order: parsed.data.sort_order,
      payload: validatedPayload,
    },
  );
  if (!planned.ok) {
    return jsonError(planned.status, planned.error);
  }

  const blockKey = readPayloadBlockKey(validatedPayload);
  if (blockKey !== undefined) {
    const { data: siblings, error: siblingsError } = await supabase
      .from("dashboard_blocks")
      .select("id, payload, block_key")
      .eq("section_id", parsed.data.section_id);

    if (siblingsError) {
      return jsonError(500, "failed to load section blocks");
    }
    if (
      sectionHasBlockKeyConflict(
        (siblings ?? []) as Array<{
          id: string;
          payload: string;
          block_key?: string | null;
        }>,
        blockKey,
      )
    ) {
      return dashboardBlockKeyConflictResponse();
    }
  }

  const id = randomUUID();
  const encryptedPayload = encryptBlockPayload(id, planned.plan.payload);

  const { data, error } = await supabase.rpc("create_dashboard_block", {
    p_id: id,
    p_section_id: planned.plan.section_id,
    p_block_type: planned.plan.block_type,
    p_sort_order: planned.plan.sort_order,
    p_agent_id: planned.plan.agent_id,
    p_payload: encryptedPayload,
    p_block_key: blockKey ?? null,
  });

  if (error) {
    // Never log payload, token, or hash — only opaque ids / codes.
    console.error("create_dashboard_block failed", {
      blockId: id,
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
    return jsonError(500, "failed to create block");
  }

  if (!data || !(data as { block?: DashboardBlockRow }).block) {
    return jsonError(500, "failed to create block");
  }

  return jsonOkNoStore(
    { block: toPublicBlock((data as { block: DashboardBlockRow }).block) },
    { status: 201 },
  );
}
