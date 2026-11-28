/**
 * Per-category dashboard writers. Owner assigns one agent per category;
 * agents may write that category only when designated. No row → deny all writes.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDashboardCategory } from "@/lib/dashboard/category";

export type DashboardWriterRow = {
  category: string;
  writer_agent_id: string;
  updated_at: string;
};

export type WriterCheckResult =
  | { ok: true }
  | { ok: false; status: 403; error: string };

/**
 * Fail closed: missing writer row or mismatched agent → 403.
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
    .select("writer_agent_id")
    .eq("category", needle)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (!data || data.writer_agent_id !== agentId) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true };
}

export async function listDashboardWriters(
  supabase: SupabaseClient,
): Promise<DashboardWriterRow[]> {
  const { data, error } = await supabase
    .from("dashboard_writers")
    .select("category, writer_agent_id, updated_at")
    .order("category", { ascending: true });
  if (error) {
    throw new Error("failed to load dashboard writers");
  }
  return (data ?? []) as DashboardWriterRow[];
}

export async function upsertDashboardWriter(
  supabase: SupabaseClient,
  input: { category: string; writerAgentId: string },
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
    .eq("id", input.writerAgentId)
    .maybeSingle();
  if (agentError) {
    return { ok: false, status: 500, error: "failed to load agent" };
  }
  if (!agent) {
    return { ok: false, status: 404, error: "agent not found" };
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("dashboard_writers")
    .upsert(
      {
        category,
        writer_agent_id: input.writerAgentId,
        updated_at: now,
      },
      { onConflict: "category" },
    )
    .select("category, writer_agent_id, updated_at")
    .single();

  if (error || !data) {
    return { ok: false, status: 500, error: "failed to upsert writer" };
  }
  return { ok: true, writer: data as DashboardWriterRow };
}

/**
 * Pure backfill helper (mirrors migration; no agent ids hardcoded).
 * - Unique section owner per category → that agent
 * - bank inherits cpf writer when cpf is set
 * - Multi-owner categories omitted
 */
export function backfillDashboardWriters(
  sections: ReadonlyArray<{ category: string; agent_id: string | null }>,
): Array<{ category: string; writer_agent_id: string }> {
  const byCat = new Map<string, Set<string>>();
  for (const row of sections) {
    if (row.agent_id == null) continue;
    const cat = normalizeDashboardCategory(row.category);
    if (!cat) continue;
    const set = byCat.get(cat) ?? new Set<string>();
    set.add(row.agent_id);
    byCat.set(cat, set);
  }

  const out: Array<{ category: string; writer_agent_id: string }> = [];
  for (const [category, owners] of byCat) {
    if (owners.size !== 1) continue;
    const [writer] = owners;
    if (!writer) continue;
    out.push({ category, writer_agent_id: writer });
  }

  const cpf = out.find((r) => r.category === "cpf");
  if (cpf) {
    const withoutBank = out.filter((r) => r.category !== "bank");
    withoutBank.push({
      category: "bank",
      writer_agent_id: cpf.writer_agent_id,
    });
    return withoutBank.sort((a, b) => a.category.localeCompare(b.category));
  }
  return out.sort((a, b) => a.category.localeCompare(b.category));
}
