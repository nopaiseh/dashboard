import { resolveAgentFromRequest } from "@/lib/agent-service";
import {
  decryptBlockPayload,
  encryptBlockPayload,
} from "@/lib/dashboard/crypto";
import { planPatchBlock } from "@/lib/dashboard/logic";
import type {
  DashboardBlockPublic,
  DashboardBlockRow,
} from "@/lib/dashboard/types";
import { jsonError, jsonOk } from "@/lib/http";
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

  const parsed = patchDashboardBlockSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
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

  let nextPayload: Record<string, unknown> | undefined;
  if (parsed.data.payload !== undefined) {
    const payloadParsed = dashboardPayloadSchemaFor(nextType).safeParse(
      parsed.data.payload,
    );
    if (!payloadParsed.success) {
      return jsonError(400, "invalid body");
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

  const patch: Record<string, unknown> = {};
  if (planned.plan.block_type !== undefined) {
    patch.block_type = planned.plan.block_type;
  }
  if (planned.plan.sort_order !== undefined) {
    patch.sort_order = planned.plan.sort_order;
  }
  if (planned.plan.payload !== undefined) {
    patch.payload = encryptBlockPayload(id, planned.plan.payload);
  }

  const { data: updated, error } = await supabase
    .from("dashboard_blocks")
    .update(patch)
    .eq("id", id)
    .eq("agent_id", auth.agent.agentId)
    .select("*")
    .maybeSingle();

  if (error) {
    return jsonError(500, "failed to update block");
  }
  if (!updated) {
    return jsonError(403, "forbidden");
  }

  await supabase.from("dashboard_block_events").insert({
    block_id: id,
    actor_type: "agent",
    agent_id: auth.agent.agentId,
    action: "update",
  });

  return jsonOk({ block: toPublicBlock(updated as DashboardBlockRow) });
}
