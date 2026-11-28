import { resolveAgentFromRequest } from "@/lib/agent-service";
import { planPatchSection } from "@/lib/dashboard/logic";
import { containsSingaporeNricOrFin } from "@/lib/dashboard/nric-guard";
import type { DashboardSectionRow } from "@/lib/dashboard/types";
import { assertAgentIsCategoryWriter } from "@/lib/dashboard/writers";
import { dashboardInvalidPayloadResponse } from "@/lib/dashboard/write-errors";
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

  if (containsSingaporeNricOrFin(body)) {
    return dashboardInvalidPayloadResponse();
  }

  const parsed = patchDashboardSectionSchema.safeParse(body);
  if (!parsed.success) {
    return dashboardInvalidPayloadResponse();
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

  const sectionRow = existing as DashboardSectionRow;

  // Must be writer of the current category; if renaming, also of the new one.
  const currentWriter = await assertAgentIsCategoryWriter(
    supabase,
    auth.agent.agentId,
    sectionRow.category,
  );
  if (!currentWriter.ok) {
    return jsonError(currentWriter.status, currentWriter.error);
  }

  if (parsed.data.category !== undefined) {
    const nextWriter = await assertAgentIsCategoryWriter(
      supabase,
      auth.agent.agentId,
      parsed.data.category,
    );
    if (!nextWriter.ok) {
      return jsonError(nextWriter.status, nextWriter.error);
    }
  }

  const planned = planPatchSection(
    auth.agent.agentId,
    sectionRow,
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
    .select("*")
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return jsonError(409, "conflict");
    }
    return jsonError(500, "failed to update section");
  }
  if (!section) {
    return jsonError(404, "section not found");
  }

  return jsonOk({ section });
}
