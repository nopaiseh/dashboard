import { resolveAgentFromRequest } from "@/lib/agent-service";
import {
  assertCategoryAllowedForToken,
  planPatchSection,
} from "@/lib/dashboard/logic";
import { containsSingaporeNricOrFin } from "@/lib/dashboard/nric-guard";
import {
  assertSensitiveCategoryWritable,
  assertSensitiveSectionCreatable,
} from "@/lib/dashboard/sensitive-exclusivity";
import type { DashboardSectionRow } from "@/lib/dashboard/types";
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

  // Changing category requires allow-list for the *new* category; otherwise
  // the current category must already be allowed (token scoped writes).
  const targetCategory = parsed.data.category ?? sectionRow.category;
  const catAllowed = assertCategoryAllowedForToken(
    auth.agent.allowedCategories,
    targetCategory,
  );
  if (!catAllowed.ok) {
    return jsonError(catAllowed.status, catAllowed.error);
  }

  // Write-time sensitive lock: changing into a sensitive category uses the
  // full uniqueness check; otherwise ownership of the loaded section.
  const writable = await assertSensitiveCategoryWritable(
    supabase,
    auth.agent.agentId,
    targetCategory,
    parsed.data.category !== undefined
      ? undefined
      : { knownSectionAgentId: sectionRow.agent_id },
  );
  if (!writable.ok) {
    return jsonError(writable.status, writable.error);
  }

  if (parsed.data.category !== undefined) {
    const exclusive = await assertSensitiveSectionCreatable(
      supabase,
      auth.agent.agentId,
      parsed.data.category,
      { excludeSectionId: id },
    );
    if (!exclusive.ok) {
      return jsonError(exclusive.status, exclusive.error);
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
    .eq("agent_id", auth.agent.agentId)
    .select("*")
    .maybeSingle();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return jsonError(409, "conflict");
    }
    if (
      (error as { message?: string }).message?.includes("sensitive category")
    ) {
      return jsonError(403, "forbidden");
    }
    return jsonError(500, "failed to update section");
  }
  if (!section) {
    return jsonError(403, "forbidden");
  }

  return jsonOk({ section });
}
