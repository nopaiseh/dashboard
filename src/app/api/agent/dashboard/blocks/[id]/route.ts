import { resolveAgentFromRequest } from "@/lib/agent-service";
import {
  readPayloadBlockKey,
  sectionHasBlockKeyConflict,
} from "@/lib/dashboard/block-key";
import {
  decryptBlockPayload,
  encryptBlockPayload,
} from "@/lib/dashboard/crypto";
import { planPatchBlock } from "@/lib/dashboard/logic";
import { containsSingaporeNricOrFin } from "@/lib/dashboard/nric-guard";
import type {
  DashboardBlockPublic,
  DashboardBlockRow,
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
import {
  dashboardPayloadSchemaFor,
  patchDashboardBlockSchema,
} from "@/lib/validation";
import { requireRequest } from "@/lib/require-request";

type RouteContext = { params: Promise<{ id: string }> };

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

export async function PATCH(request: Request, context: RouteContext) {
  await requireRequest();
  const { id } = await context.params;
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

  const parsed = patchDashboardBlockSchema.safeParse(body);
  if (!parsed.success) {
    return dashboardInvalidPayloadResponse();
  }

  const { data: existing, error: loadError } = await supabase
    .from("dashboard_blocks")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return jsonError(500, "failed to load block");
  }
  if (!existing) {
    return jsonError(404, "block not found");
  }

  const block = existing as DashboardBlockRow;
  const nextType = parsed.data.block_type ?? block.block_type;

  if (
    parsed.data.block_type !== undefined &&
    parsed.data.block_type !== block.block_type &&
    parsed.data.payload === undefined
  ) {
    return dashboardInvalidPayloadResponse();
  }

  let nextPayload: Record<string, unknown> | undefined;
  if (parsed.data.payload !== undefined) {
    const payloadParsed = dashboardPayloadSchemaFor(nextType).safeParse(
      parsed.data.payload,
    );
    if (!payloadParsed.success) {
      return dashboardInvalidPayloadResponse();
    }
    nextPayload = payloadParsed.data as Record<string, unknown>;
  }

  const planned = planPatchBlock(auth.agent.agentId, block, {
    block_type: parsed.data.block_type,
    sort_order: parsed.data.sort_order,
    payload: nextPayload,
  });
  if (!planned.ok) {
    return jsonError(planned.status, planned.error);
  }

  if (nextPayload !== undefined) {
    const blockKey = readPayloadBlockKey(nextPayload);
    if (blockKey !== undefined) {
      // Race window: concurrent writers can both pass before either commits
      // (acceptable for a single-writer agent; key is encrypted, not a DB column).
      const { data: siblings, error: siblingsError } = await supabase
        .from("dashboard_blocks")
        .select("id, payload")
        .eq("section_id", block.section_id);

      if (siblingsError) {
        return jsonError(500, "failed to load section blocks");
      }
      if (
        sectionHasBlockKeyConflict(
          (siblings ?? []) as Array<{ id: string; payload: string }>,
          blockKey,
          id,
        )
      ) {
        return dashboardBlockKeyConflictResponse();
      }
    }
  }

  const touchPayload = planned.plan.payload !== undefined;
  const encryptedPayload = touchPayload
    ? encryptBlockPayload(id, planned.plan.payload!)
    : null;

  const { data, error } = await supabase.rpc(
    "apply_agent_dashboard_block_patch",
    {
      p_block_id: id,
      p_agent_id: auth.agent.agentId,
      p_touch_block_type: planned.plan.block_type !== undefined,
      p_block_type: planned.plan.block_type ?? block.block_type,
      p_touch_sort_order: planned.plan.sort_order !== undefined,
      p_sort_order: planned.plan.sort_order ?? block.sort_order,
      p_touch_payload: touchPayload,
      p_payload: encryptedPayload,
    },
  );

  if (error) {
    console.error("apply_agent_dashboard_block_patch failed", {
      blockId: id,
      code: (error as { code?: string }).code ?? "unknown",
    });
    if (isPgConflict(error)) {
      return jsonError(409, "conflict");
    }
    if (isPgForbidden(error)) {
      return jsonError(403, "forbidden");
    }
    if (isPgNotFound(error)) {
      return jsonError(404, "block not found");
    }
    return jsonError(500, "failed to update block");
  }

  if (!data || !(data as { block?: DashboardBlockRow }).block) {
    return jsonError(500, "failed to update block");
  }

  return jsonOkNoStore({
    block: toPublicBlock((data as { block: DashboardBlockRow }).block),
  });
}
