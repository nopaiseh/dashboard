import { z } from "zod";
import { resolveAgentFromRequest } from "@/lib/agent-service";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { buildNewItemFields } from "@/lib/items-logic";
import { getServiceClient } from "@/lib/supabase/server";

const createSchema = z.object({
  kind: z.enum([
    "approval",
    "todo",
    "question_to_user",
    "question_from_user",
    "waiting",
  ]),
  project: z.string().optional(),
  title: z.string().min(1),
  body: z.string().optional(),
  options: z
    .array(z.object({ key: z.string(), label: z.string() }))
    .optional(),
  due_at: z.string().nullable().optional(),
  source_url: z.string().nullable().optional(),
});

export async function POST(request: Request) {
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const nowIso = new Date().toISOString();
  const fields = buildNewItemFields(auth.agent.agentId, parsed.data, nowIso);

  const { data: item, error } = await supabase
    .from("items")
    .insert(fields)
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

  return jsonOk({ item }, { status: 201 });
}
