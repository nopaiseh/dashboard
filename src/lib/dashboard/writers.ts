/**
 * Per-category dashboard writers (many-to-many). Owner adds/removes agents;
 * write allowed only when the token agent is listed. Empty list → deny all.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDashboardCategory } from "@/lib/dashboard/category";

export type DashboardWriterRow = {
  category: string;
  agent_id: string;
  created_at: string;
};

export type WriterCheckResult =
  | { ok: true }
  | { ok: false; status: 403; error: string };

/**
 * Fail closed: no membership row for (category, agent) → 403.
 */
export async function assertAgentIsCategoryWriter(
  supabase: SupabaseClient,
  agentId: string,
  category: string,
): Promise<WriterCheckResult> {
  const needle = normalizeDashboardCategory(category);
  if (!needle) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  const { data, error } = await supabase
    .from("dashboard_writers")
    .select("agent_id")
    .eq("category", needle)
    .eq("agent_id", agentId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (!data || data.agent_id !== agentId) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true };
}

export async function listDashboardWriters(
  supabase: SupabaseClient,
  options?: { category?: string },
): Promise<DashboardWriterRow[]> {
  let query = supabase
    .from("dashboard_writers")
    .select("category, agent_id, created_at")
    .order("category", { ascending: true })
    .order("agent_id", { ascending: true });

  if (options?.category !== undefined) {
    const cat = normalizeDashboardCategory(options.category);
    if (!cat) return [];
    query = query.eq("category", cat);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("failed to load dashboard writers");
  }
  return (data ?? []) as DashboardWriterRow[];
}

export async function addDashboardWriter(
  supabase: SupabaseClient,
  input: { category: string; agentId: string },
): Promise<
  | { ok: true; writer: DashboardWriterRow }
  | { ok: false; status: number; error: string }
> {
  const category = normalizeDashboardCategory(input.category);
  if (!category) {
    return { ok: false, status: 400, error: "invalid body" };
  }

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id")
    .eq("id", input.agentId)
    .maybeSingle();
  if (agentError) {
    return { ok: false, status: 500, error: "failed to load agent" };
  }
  if (!agent) {
    return { ok: false, status: 404, error: "agent not found" };
  }

  const { data, error } = await supabase
    .from("dashboard_writers")
    .upsert(
      {
        category,
        agent_id: input.agentId,
      },
      { onConflict: "category,agent_id", ignoreDuplicates: true },
    )
    .select("category, agent_id, created_at")
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "failed to add writer" };
  }

  // ignoreDuplicates may return null; re-read the row.
  if (!data) {
    const { data: existing, error: loadError } = await supabase
      .from("dashboard_writers")
      .select("category, agent_id, created_at")
      .eq("category", category)
      .eq("agent_id", input.agentId)
      .maybeSingle();
    if (loadError || !existing) {
      return { ok: false, status: 500, error: "failed to add writer" };
    }
    return { ok: true, writer: existing as DashboardWriterRow };
  }

  return { ok: true, writer: data as DashboardWriterRow };
}

export async function removeDashboardWriter(
  supabase: SupabaseClient,
  input: { category: string; agentId: string },
): Promise<
  | { ok: true; category: string; agentId: string }
  | { ok: false; status: number; error: string }
> {
  const category = normalizeDashboardCategory(input.category);
  if (!category) {
    return { ok: false, status: 400, error: "invalid body" };
  }

  const { data, error } = await supabase
    .from("dashboard_writers")
    .delete()
    .eq("category", category)
    .eq("agent_id", input.agentId)
    .select("category, agent_id")
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "failed to remove writer" };
  }
  if (!data) {
    return { ok: false, status: 404, error: "writer not found" };
  }
  return { ok: true, category, agentId: input.agentId };
}

/**
 * Pure backfill helper (mirrors migration; no agent ids hardcoded).
 * - Ordinary categories: every section owner becomes a writer
 * - cpf / bank: only when exactly one agent owns a cpf section → that
 *   agent is the sole writer for both; otherwise neither is backfilled
 * - travel: never auto-backfilled (owner assigns via API; empty → 403)
 */
export function backfillDashboardWriters(
  sections: ReadonlyArray<{ category: string; agent_id: string | null }>,
): Array<{ category: string; agent_id: string }> {
  const byCat = new Map<string, Set<string>>();
  for (const row of sections) {
    if (row.agent_id == null) continue;
    const cat = normalizeDashboardCategory(row.category);
    if (!cat) continue;
    const set = byCat.get(cat) ?? new Set<string>();
    set.add(row.agent_id);
    byCat.set(cat, set);
  }

  const out: Array<{ category: string; agent_id: string }> = [];

  for (const [category, agents] of [...byCat.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (
      category === "cpf" ||
      category === "bank" ||
      category === "travel"
    ) {
      continue;
    }
    for (const agent_id of [...agents].sort()) {
      out.push({ category, agent_id });
    }
  }

  const cpfOwners = byCat.get("cpf") ?? new Set<string>();
  if (cpfOwners.size === 1) {
    const [agent_id] = cpfOwners;
    if (agent_id) {
      out.push({ category: "bank", agent_id });
      out.push({ category: "cpf", agent_id });
    }
  }

  return out.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.agent_id.localeCompare(b.agent_id),
  );
}
