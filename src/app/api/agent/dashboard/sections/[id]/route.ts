import { resolveAgentFromRequest } from "@/lib/agent-service";
import { planPatchSection } from "@/lib/dashboard/logic";
import type { DashboardSectionRow } from "@/lib/dashboard/types";
import { jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import { patchDashboardSectionSchema } from "@/lib/validation";
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

  const parsed = patchDashboardSectionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const { data: existing, error: loadError } = await supabase
    .from("dashboard_sections")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (loadError) {
    return jsonError(500, "failed to load section");
  }
  if (!existing) {
    return jsonError(404, "section not found");
  }

  const planned = planPatchSection(
    auth.agent.agentId,
    existing as DashboardSectionRow,
    parsed.data,
  );
  if (!planned.ok) {
    return jsonError(planned.status, planned.error);
  }

  const patch: Record<string, unknown> = {};
  if (planned.plan.category !== undefined) {
    patch.category = planned.plan.category;
  }
  if (planned.plan.sort_order !== undefined) {
    patch.sort_order = planned.plan.sort_order;
  }

  const { data: section, error } = await supabase
    .from("dashboard_sections")
    .update(patch)
    .eq("id", id)
    .eq("agent_id", auth.agent.agentId)
    .select("*")
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return jsonError(409, "conflict");
    }
    return jsonError(500, "failed to update section");
  }
  if (!section) {
    return jsonError(403, "forbidden");
  }

  return jsonOk({ section });
}
