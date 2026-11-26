import { resolveAgentFromRequest } from "@/lib/agent-service";
import { jsonError, jsonOk } from "@/lib/http";
import { applyAgentPatch } from "@/lib/items-logic";
import { getServiceClient } from "@/lib/supabase/server";
import type { ItemRow } from "@/lib/types";
import { patchItemSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
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

  const result = applyAgentPatch(
    auth.agent.agentId,
    existing as ItemRow,
    parsed.data,
  );
  if (!result.ok) {
    return jsonError(result.status, result.error);
  }

  const { data: updated, error: updateError } = await supabase
    .from("items")
    .update(result.next)
    .eq("id", id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return jsonError(500, "failed to update item");
  }

  await supabase.from("item_events").insert({
    item_id: id,
    actor_type: "agent",
    agent_id: auth.agent.agentId,
    action: result.contentReopened ? "update" : parsed.data.status === "withdrawn" ? "withdraw" : "update",
    content_hash: updated.content_hash,
  });

  return jsonOk({
    item: updated,
    content_reopened: result.contentReopened,
  });
}
