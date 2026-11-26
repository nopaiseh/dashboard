import { annotateInvalidated } from "@/lib/content-hash";
import { resolveAgentFromRequest } from "@/lib/agent-service";
import { jsonError, jsonOk } from "@/lib/http";
import { itemHasFinalDecision } from "@/lib/items-logic";
import { getServiceClient } from "@/lib/supabase/server";
import type { ItemEventRow, ItemRow, ItemStatus } from "@/lib/types";

export async function GET(request: Request) {
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

  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  let query = supabase
    .from("items")
    .select("*")
    .eq("agent_id", auth.agent.agentId)
    .neq("status", "open")
    .order("updated_at", { ascending: true });

  if (since) {
    query = query.gte("updated_at", since);
  }

  const { data: items, error } = await query;
  if (error) {
    return jsonError(500, "failed to load inbox");
  }

  const decided = ((items ?? []) as ItemRow[]).filter((item) =>
    itemHasFinalDecision(item.status as ItemStatus),
  );

  const results = [];
  for (const item of decided) {
    const { data: events } = await supabase
      .from("item_events")
      .select("*")
      .eq("item_id", item.id)
      .in("action", ["approve", "reject", "reply", "withdraw"])
      .order("created_at", { ascending: true });

    const annotated = ((events ?? []) as ItemEventRow[]).map((event) =>
      annotateInvalidated(event, item.content_hash),
    );

    results.push({
      item,
      decisions: annotated,
    });
  }

  return jsonOk({ since, items: results });
}
