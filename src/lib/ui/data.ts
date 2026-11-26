import "server-only";

import { heldCutoffIso, isHeldItem } from "@/lib/ui/held";
import { hasInvalidatedApproval } from "@/lib/ui/invalidation";
import { getServiceClient } from "@/lib/supabase/server";
import type {
  ItemEventRow,
  ItemKind,
  ItemRow,
  ItemStatus,
} from "@/lib/types";

export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  area: string;
  bot_id: string | null;
  created_at: string;
}

export interface GoalRow {
  id: string;
  area: string;
  title: string;
  target: string;
  metric: string;
  progress: number;
  due_at: string | null;
  agent_id: string | null;
  status: string;
  updated_at: string;
}

export interface DailySummaryRow {
  date: string;
  content: string;
  generated_by: string;
  created_at: string;
}

export interface ItemWithMeta extends ItemRow {
  agent_name: string;
  agent_area: string;
  invalidated_approval: boolean;
}

export interface Counts {
  approval: number;
  todo: number;
  question_to_user: number;
  question_from_user: number;
  waiting: number;
  held: number;
}

async function loadAgentsMap(): Promise<Map<string, AgentRow>> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("agents").select("*");
  if (error || !data) return new Map();
  return new Map((data as AgentRow[]).map((a) => [a.id, a]));
}

function attachMeta(
  items: ItemRow[],
  agents: Map<string, AgentRow>,
  invalidatedIds: Set<string>,
): ItemWithMeta[] {
  return items.map((item) => {
    const agent = agents.get(item.agent_id);
    return {
      ...item,
      agent_name: agent?.name ?? "未知姐妹",
      agent_area: agent?.area ?? "",
      invalidated_approval: invalidatedIds.has(item.id),
    };
  });
}

async function findInvalidatedApprovalIds(
  items: ItemRow[],
): Promise<Set<string>> {
  const candidates = items.filter(
    (i) => i.status === "open" && i.kind === "approval",
  );
  if (candidates.length === 0) return new Set();

  const supabase = getServiceClient();
  const ids = candidates.map((i) => i.id);
  const { data } = await supabase
    .from("item_events")
    .select("item_id, action, content_hash")
    .in("item_id", ids)
    .eq("action", "approve");

  const byItem = new Map<string, Array<{ action: string; content_hash: string | null }>>();
  for (const row of (data ?? []) as Array<{
    item_id: string;
    action: string;
    content_hash: string | null;
  }>) {
    const list = byItem.get(row.item_id) ?? [];
    list.push(row);
    byItem.set(row.item_id, list);
  }

  const out = new Set<string>();
  for (const item of candidates) {
    const events = byItem.get(item.id) ?? [];
    if (hasInvalidatedApproval(item, events as ItemEventRow[])) {
      out.add(item.id);
    }
  }
  return out;
}

export async function loadAllItems(): Promise<ItemRow[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .order("last_activity_at", { ascending: false });
  if (error || !data) return [];
  return data as ItemRow[];
}

export async function loadItemsByKind(
  kind: ItemKind,
  status?: ItemStatus,
): Promise<ItemWithMeta[]> {
  const supabase = getServiceClient();
  let query = supabase
    .from("items")
    .select("*")
    .eq("kind", kind)
    .order("last_activity_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error || !data) return [];
  const items = data as ItemRow[];
  const [agents, invalidated] = await Promise.all([
    loadAgentsMap(),
    findInvalidatedApprovalIds(items),
  ]);
  return attachMeta(items, agents, invalidated);
}

export async function loadHeldItems(): Promise<ItemWithMeta[]> {
  const supabase = getServiceClient();
  const cutoff = heldCutoffIso();
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("status", "open")
    .lt("last_activity_at", cutoff)
    .order("last_activity_at", { ascending: false });
  if (error || !data) return [];
  const items = data as ItemRow[];
  const [agents, invalidated] = await Promise.all([
    loadAgentsMap(),
    findInvalidatedApprovalIds(items),
  ]);
  return attachMeta(items, agents, invalidated);
}

export async function loadOpenApprovals(limit = 20): Promise<ItemWithMeta[]> {
  const items = await loadItemsByKind("approval", "open");
  return items.slice(0, limit);
}

export async function loadCounts(now: Date = new Date()): Promise<Counts> {
  const items = await loadAllItems();
  const counts: Counts = {
    approval: 0,
    todo: 0,
    question_to_user: 0,
    question_from_user: 0,
    waiting: 0,
    held: 0,
  };
  for (const item of items) {
    if (item.status !== "open") continue;
    if (isHeldItem(item.status, item.last_activity_at, now)) {
      counts.held += 1;
    }
    if (item.kind === "approval") counts.approval += 1;
    else if (item.kind === "todo") counts.todo += 1;
    else if (item.kind === "question_to_user") counts.question_to_user += 1;
    else if (item.kind === "question_from_user") counts.question_from_user += 1;
    else if (item.kind === "waiting") counts.waiting += 1;
  }
  return counts;
}

export async function loadLatestSummary(): Promise<DailySummaryRow | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("daily_summaries")
    .select("*")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as DailySummaryRow;
}

export async function loadGoals(): Promise<
  Array<GoalRow & { agent_name: string | null }>
> {
  const supabase = getServiceClient();
  const [{ data: goals }, agents] = await Promise.all([
    supabase.from("goals").select("*").order("updated_at", { ascending: false }),
    loadAgentsMap(),
  ]);
  if (!goals) return [];
  return (goals as GoalRow[]).map((g) => ({
    ...g,
    agent_name: g.agent_id ? agents.get(g.agent_id)?.name ?? null : null,
  }));
}

export async function loadAgents(): Promise<AgentRow[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .select("*")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as AgentRow[];
}

export interface SisterCard {
  agent: AgentRow;
  summary: string;
  openCount: number;
}

export async function loadSisterCards(): Promise<SisterCard[]> {
  const [agents, items] = await Promise.all([loadAgents(), loadAllItems()]);
  return agents.map((agent) => {
    const owned = items.filter((i) => i.agent_id === agent.id);
    const open = owned.filter((i) => i.status === "open");
    const parts: string[] = [];
    const byKind: Partial<Record<ItemKind, number>> = {};
    let held = 0;
    for (const item of open) {
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
      if (isHeldItem(item.status, item.last_activity_at)) held += 1;
    }
    const kindOrder: ItemKind[] = [
      "approval",
      "todo",
      "question_to_user",
      "question_from_user",
      "waiting",
    ];
    const kindLabels: Record<ItemKind, string> = {
      approval: "待批",
      todo: "待办",
      question_to_user: "问你的",
      question_from_user: "你问的",
      waiting: "等别人",
    };
    for (const k of kindOrder) {
      const n = byKind[k];
      if (n) parts.push(`${kindLabels[k]} ${n}`);
    }
    if (held) parts.push(`搁置 ${held}`);
    return {
      agent,
      openCount: open.length,
      summary: parts.length ? parts.join(" · ") : "无未处理",
    };
  });
}

export async function loadItemDetail(id: string): Promise<{
  item: ItemWithMeta;
  events: ItemEventRow[];
} | null> {
  const supabase = getServiceClient();
  const { data: item, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !item) return null;

  const typed = item as ItemRow;
  const [{ data: events }, agents, invalidated] = await Promise.all([
    supabase
      .from("item_events")
      .select("*")
      .eq("item_id", id)
      .order("created_at", { ascending: false }),
    loadAgentsMap(),
    findInvalidatedApprovalIds([typed]),
  ]);

  const withMeta = attachMeta([typed], agents, invalidated)[0];
  return {
    item: withMeta,
    events: (events ?? []) as ItemEventRow[],
  };
}
