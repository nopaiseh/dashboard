import { randomUUID } from "node:crypto";
import { resolveAgentFromRequest } from "@/lib/agent-service";
import { planCreateSection } from "@/lib/dashboard/logic";
import { containsSingaporeNricOrFin } from "@/lib/dashboard/nric-guard";
import { assertAgentIsCategoryWriter } from "@/lib/dashboard/writers";
import { dashboardInvalidPayloadResponse } from "@/lib/dashboard/write-errors";
import { jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import { createDashboardSectionSchema } from "@/lib/validation";
import { requireRequest } from "@/lib/require-request";

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

  const parsed = createDashboardSectionSchema.safeParse(body);
  if (!parsed.success) {
    return dashboardInvalidPayloadResponse();
  }

  const writer = await assertAgentIsCategoryWriter(
    supabase,
    auth.agent.agentId,
    parsed.data.category,
  );
  if (!writer.ok) {
    return jsonError(writer.status, writer.error);
  }

  const planned = planCreateSection(auth.agent.agentId, parsed.data);
  if (!planned.ok) {
    return jsonError(planned.status, planned.error);
  }

  const row = {
    id: randomUUID(),
    category: planned.plan.category,
    sort_order: planned.plan.sort_order,
    agent_id: planned.plan.agent_id,
  };

  const { data: section, error } = await supabase
    .from("dashboard_sections")
    .insert(row)
    .select("*")
    .single();

  if (error || !section) {
    if ((error as { code?: string } | null)?.code === "23505") {
      return jsonError(409, "conflict");
    }
    return jsonError(500, "failed to create section");
  }

  return jsonOk({ section }, { status: 201 });
}
