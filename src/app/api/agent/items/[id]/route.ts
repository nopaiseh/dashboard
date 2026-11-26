import { resolveAgentFromRequest } from "@/lib/agent-service";
import {
  decryptItemSensitiveFields,
  encryptField,
  encryptNullableField,
} from "@/lib/crypto/fields";
import { jsonError, jsonOk } from "@/lib/http";
import { planAgentPatch } from "@/lib/items-logic";
import {
  isPgConflict,
  isPgForbidden,
  isPgNotFound,
} from "@/lib/pg-errors";
import { getServiceClient } from "@/lib/supabase/server";
import type { ItemRow } from "@/lib/types";
import { patchItemSchema } from "@/lib/validation";
import { requireRequest } from "@/lib/require-request";

type RouteContext = { params: Promise<{ id: string }> };

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

  const parsed = patchItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  // 轻量预检（所有权 / 状态规则）；真正更新在 RPC 事务内 FOR UPDATE
  const { data: existing, error: loadError } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return jsonError(500, "failed to load item");
  }
  if (!existing) {
    return jsonError(404, "item not found");
  }

  const decrypted = decryptItemSensitiveFields(existing as ItemRow);
  if (decrypted.decrypt_failed) {
    return jsonError(422, "item fields could not be decrypted");
  }

  const planned = planAgentPatch(
    auth.agent.agentId,
    decrypted,
    parsed.data,
  );
  if (!planned.ok) {
    return jsonError(planned.status, planned.error);
  }

  const { plan } = planned;
  const { data, error } = await supabase.rpc("apply_agent_item_patch", {
    p_item_id: id,
    p_agent_id: auth.agent.agentId,
    p_expected_status: plan.expectedStatus,
    p_expected_content_hash: plan.expectedContentHash,
    p_new_content_hash: plan.newContentHash,
    p_set_status: plan.setStatus,
    p_new_status: plan.newStatus,
    p_title:
      plan.fields.title === null
        ? null
        : encryptField(plan.fields.title, { itemId: id, column: "title" }),
    p_body:
      plan.fields.body === null
        ? null
        : encryptField(plan.fields.body, { itemId: id, column: "body" }),
    p_options: plan.fields.options,
    p_project: plan.fields.project,
    p_due_at: plan.fields.due_at === undefined ? null : plan.fields.due_at,
    p_touch_due_at: plan.fields.due_at !== undefined,
    p_source_url:
      plan.fields.source_url === undefined
        ? null
        : encryptNullableField(plan.fields.source_url, {
            itemId: id,
            column: "source_url",
          }),
    p_touch_source_url: plan.fields.source_url !== undefined,
    p_kind: plan.fields.kind,
    p_event_action: plan.eventAction,
  });

  if (error) {
    if (isPgConflict(error)) {
      return jsonError(409, "conflict");
    }
    if (isPgForbidden(error)) {
      return jsonError(403, "forbidden");
    }
    if (isPgNotFound(error)) {
      return jsonError(404, "item not found");
    }
    console.error("apply_agent_item_patch failed", error);
    return jsonError(500, "failed to update item");
  }

  if (!data) {
    return jsonError(409, "conflict");
  }

  const rpcItem = (data as { item: ItemRow }).item;
  return jsonOk({
    item: decryptItemSensitiveFields(rpcItem),
    content_reopened: plan.contentReopened,
  });
}
