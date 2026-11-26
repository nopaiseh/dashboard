import { resolveAgentFromRequest } from "@/lib/agent-service";
import {
  decryptItemSensitiveFields,
  encryptItemSensitiveFields,
} from "@/lib/crypto/fields";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { buildNewItemFields } from "@/lib/items-logic";
import { getServiceClient } from "@/lib/supabase/server";
import type { ItemRow } from "@/lib/types";
import { createItemSchema } from "@/lib/validation";
import { requireRequest } from "@/lib/require-request";

export async function POST(request: Request) {
  await requireRequest();
  void clientIp(request);
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

  const parsed = createItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const nowIso = new Date().toISOString();
  // Pre-generate id so AES-GCM AAD can bind items:{id}:{column}:vN before insert.
  const fields = buildNewItemFields(auth.agent.agentId, parsed.data, nowIso);
  const encrypted = encryptItemSensitiveFields(fields);

  const { data: item, error } = await supabase
    .from("items")
    .insert(encrypted)
    .select("*")
    .single();

  if (error || !item) {
    return jsonError(500, "failed to create item");
  }

  await supabase.from("item_events").insert({
    item_id: item.id,
    actor_type: "agent",
    agent_id: auth.agent.agentId,
    action: "create",
    content_hash: item.content_hash,
  });

  return jsonOk(
    { item: decryptItemSensitiveFields(item as ItemRow) },
    { status: 201 },
  );
}
