import "server-only";

import { requireSession } from "@/lib/auth-guard";
import {
  DataReadError,
  SessionRequiredError,
} from "@/lib/read/errors";
import { heldCutoffIso, isHeldItem } from "@/lib/read/held";
import { isValidUuid } from "@/lib/read/ids";
import { hasInvalidatedApproval } from "@/lib/read/invalidation";
import { getServiceClient } from "@/lib/supabase/server";
import {
  DECISION_STATUSES,
  type ItemAction,
  type ItemEventPublic,
  type ItemKind,
  type ItemRow,
  type ItemStatus,
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
  /** null = 不适用（仍 open）；true/false = 已读/待读 */
  result_read: boolean | null;
}

export interface Counts {
  approval: number;
  todo: number;
  question_to_user: number;
  question_from_user: number;
  waiting: number;
  held: number;
}

export interface SisterCard {
  agent: AgentRow;
  summary: string;
  openCount: number;
}

const ITEM_COLUMNS =
  "id, kind, agent_id, project, title, body, options, due_at, source_url, status, content_hash, created_at, updated_at, last_activity_at, result_read_at";

const AGENT_COLUMNS = "id, slug, name, area, bot_id, created_at";

const GOAL_COLUMNS =
  "id, area, title, target, metric, progress, due_at, agent_id, status, updated_at";

const SUMMARY_COLUMNS = "date, content, generated_by, created_at";

/** 绝不包含 credential_id */
const ITEM_EVENT_PUBLIC_COLUMNS =
  "id, item_id, actor_type, agent_id, action, option_key, reply_text, verified_at, content_hash, created_at";

const INVALIDATION_EVENT_COLUMNS = "item_id, action, content_hash";

async function ensureSession(): Promise<void> {
  const session = await requireSession();
  if (!session.ok) {
    throw new SessionRequiredError(session.error);
  }
}

function throwReadError(
  context: string,
  error: { message?: string } | null | undefined,
  table?: string,
): never {
  console.error(`[read] ${context}`, error);
  throw new DataReadError(context, { cause: error, table });
}

function assertNoError(
  context: string,
  error: { message?: string } | null | undefined,
  table?: string,
): void {
  if (error) {
    throwReadError(context, error, table);
  }
}

function resultReadFlag(
  item: Pick<ItemRow, "status" | "result_read_at">,
): boolean | null {
  if (!DECISION_STATUSES.has(item.status)) {
    return null;
  }
  return item.result_read_at != null;
}

async function loadAgentsMap(): Promise<Map<string, AgentRow>> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("agents").select(AGENT_COLUMNS);
  assertNoError("failed to load agents map", error, "agents");
  return new Map(((data ?? []) as AgentRow[]).map((a) => [a.id, a]));
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
      result_read_at: item.result_read_at ?? null,
      agent_name: agent?.name ?? "未知姐妹",
      agent_area: agent?.area ?? "",
      invalidated_approval: invalidatedIds.has(item.id),
      result_read: resultReadFlag(item),
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
  const { data, error } = await supabase
    .from("item_events")
    .select(INVALIDATION_EVENT_COLUMNS)
    .in("item_id", ids)
    .eq("action", "approve");

  assertNoError(
    "failed to load approval events for invalidation check",
    error,
    "item_events",
  );

  const byItem = new Map<
    string,
    Array<{ action: ItemAction; content_hash: string | null }>
  >();
  for (const row of (data ?? []) as Array<{
    item_id: string;
    action: ItemAction;
    content_hash: string | null;
  }>) {
    const list = byItem.get(row.item_id) ?? [];
    list.push({ action: row.action, content_hash: row.content_hash });
    byItem.set(row.item_id, list);
  }

  const out = new Set<string>();
  for (const item of candidates) {
    const events = byItem.get(item.id) ?? [];
    if (hasInvalidatedApproval(item, events)) {
      out.add(item.id);
    }
  }
  return out;
}

async function countOpenByKind(kind: ItemKind): Promise<number> {
  const supabase = getServiceClient();
  const { count, error } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .eq("kind", kind);
  assertNoError(`failed to count open ${kind}`, error, "items");
  return count ?? 0;
}

async function countHeld(now: Date): Promise<number> {
  const supabase = getServiceClient();
  const cutoff = heldCutoffIso(now);
  const { count, error } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .lt("last_activity_at", cutoff);
  assertNoError("failed to count held items", error, "items");
  return count ?? 0;
}

export async function loadAllItems(): Promise<ItemRow[]> {
  await ensureSession();
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("items")
    .select(ITEM_COLUMNS)
    .order("last_activity_at", { ascending: false });
  assertNoError("failed to load items", error, "items");
  return (data ?? []) as ItemRow[];
}

export async function loadItemsByKind(
  kind: ItemKind,
  status?: ItemStatus,
): Promise<ItemWithMeta[]> {
  await ensureSession();
  const supabase = getServiceClient();
  let query = supabase.from("items").select(ITEM_COLUMNS).eq("kind", kind);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("last_activity_at", {
    ascending: false,
  });
  assertNoError(`failed to load items kind=${kind}`, error, "items");
  const items = (data ?? []) as ItemRow[];
  const [agents, invalidated] = await Promise.all([
    loadAgentsMap(),
    findInvalidatedApprovalIds(items),
  ]);
  return attachMeta(items, agents, invalidated);
}

export async function loadHeldItems(): Promise<ItemWithMeta[]> {
  await ensureSession();
  const supabase = getServiceClient();
  const cutoff = heldCutoffIso();
  const { data, error } = await supabase
    .from("items")
    .select(ITEM_COLUMNS)
    .eq("status", "open")
    .lt("last_activity_at", cutoff)
    .order("last_activity_at", { ascending: false });
  assertNoError("failed to load held items", error, "items");
  const items = (data ?? []) as ItemRow[];
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
  await ensureSession();
  const [
    approval,
    todo,
    question_to_user,
    question_from_user,
    waiting,
    held,
  ] = await Promise.all([
    countOpenByKind("approval"),
    countOpenByKind("todo"),
    countOpenByKind("question_to_user"),
    countOpenByKind("question_from_user"),
    countOpenByKind("waiting"),
    countHeld(now),
  ]);
  return {
    approval,
    todo,
    question_to_user,
    question_from_user,
    waiting,
    held,
  };
}

export async function loadLatestSummary(): Promise<DailySummaryRow | null> {
  await ensureSession();
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("daily_summaries")
    .select(SUMMARY_COLUMNS)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoError("failed to load daily summary", error, "daily_summaries");
  return (data as DailySummaryRow | null) ?? null;
}

export async function loadGoals(): Promise<
  Array<GoalRow & { agent_name: string | null }>
> {
  await ensureSession();
  const supabase = getServiceClient();
  const [{ data: goals, error }, agents] = await Promise.all([
    supabase
      .from("goals")
      .select(GOAL_COLUMNS)
      .order("updated_at", { ascending: false }),
    loadAgentsMap(),
  ]);
  assertNoError("failed to load goals", error, "goals");
  return ((goals ?? []) as GoalRow[]).map((g) => ({
    ...g,
    agent_name: g.agent_id ? agents.get(g.agent_id)?.name ?? null : null,
  }));
}

export async function loadAgents(): Promise<AgentRow[]> {
  await ensureSession();
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("agents")
    .select(AGENT_COLUMNS)
    .order("created_at", { ascending: true });
  assertNoError("failed to load agents", error, "agents");
  return (data ?? []) as AgentRow[];
}

export async function loadSisterCards(): Promise<SisterCard[]> {
  await ensureSession();
  const supabase = getServiceClient();
  const [agents, openRes] = await Promise.all([
    loadAgents(),
    supabase
      .from("items")
      .select("agent_id, kind, last_activity_at")
      .eq("status", "open"),
  ]);
  assertNoError(
    "failed to load open items for sister cards",
    openRes.error,
    "items",
  );

  const openRows = (openRes.data ?? []) as Array<{
    agent_id: string;
    kind: ItemKind;
    last_activity_at: string;
  }>;

  return agents.map((agent) => {
    const open = openRows.filter((i) => i.agent_id === agent.id);
    const parts: string[] = [];
    const byKind: Partial<Record<ItemKind, number>> = {};
    let held = 0;
    for (const item of open) {
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1;
      if (isHeldItem("open", item.last_activity_at)) held += 1;
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

export async function loadItemsForAgent(
  agentId: string,
): Promise<{ agent: AgentRow; items: ItemWithMeta[] } | null> {
  await ensureSession();
  if (!isValidUuid(agentId)) return null;

  const supabase = getServiceClient();
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select(AGENT_COLUMNS)
    .eq("id", agentId)
    .maybeSingle();
  assertNoError("failed to load agent", agentError, "agents");
  if (!agent) return null;

  const { data, error } = await supabase
    .from("items")
    .select(ITEM_COLUMNS)
    .eq("agent_id", agentId)
    .order("last_activity_at", { ascending: false });
  assertNoError("failed to load agent items", error, "items");
  const items = (data ?? []) as ItemRow[];
  const invalidated = await findInvalidatedApprovalIds(items);
  const agents = new Map([[(agent as AgentRow).id, agent as AgentRow]]);
  return {
    agent: agent as AgentRow,
    items: attachMeta(items, agents, invalidated),
  };
}

export async function loadItemDetail(id: string): Promise<{
  item: ItemWithMeta;
  events: ItemEventPublic[];
} | null> {
  await ensureSession();
  if (!isValidUuid(id)) return null;

  const supabase = getServiceClient();
  const { data: item, error } = await supabase
    .from("items")
    .select(ITEM_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  assertNoError("failed to load item", error, "items");
  if (!item) return null;

  const typed = item as ItemRow;
  const [eventsRes, agents, invalidated] = await Promise.all([
    supabase
      .from("item_events")
      .select(ITEM_EVENT_PUBLIC_COLUMNS)
      .eq("item_id", id)
      .order("created_at", { ascending: false }),
    loadAgentsMap(),
    findInvalidatedApprovalIds([typed]),
  ]);
  assertNoError("failed to load item events", eventsRes.error, "item_events");

  const withMeta = attachMeta([typed], agents, invalidated)[0];
  return {
    item: withMeta,
    events: (eventsRes.data ?? []) as ItemEventPublic[],
  };
}
