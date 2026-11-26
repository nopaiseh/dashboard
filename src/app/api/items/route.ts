import { requireSession } from "@/lib/auth-guard";
import { jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import { itemsQuerySchema } from "@/lib/validation";
import { requireRequest } from "@/lib/require-request";

export async function GET(request: Request) {
  await requireRequest();
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  const url = new URL(request.url);
  const parsed = itemsQuerySchema.safeParse({
    kind: url.searchParams.get("kind") || undefined,
    agent: url.searchParams.get("agent") || undefined,
    status: url.searchParams.get("status") || undefined,
  });
  if (!parsed.success) {
    return jsonError(400, "invalid query", {
      details: parsed.error.flatten(),
    });
  }
  const { kind, agent, status } = parsed.data;

  const supabase = getServiceClient();
  let query = supabase
    .from("items")
    .select("*")
    .order("last_activity_at", { ascending: false });

  if (kind) query = query.eq("kind", kind);
  if (agent) query = query.eq("agent_id", agent);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) {
    return jsonError(500, "failed to load items");
  }

  return jsonOk({ items: data ?? [] });
}
