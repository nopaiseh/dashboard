import { computeContentHash } from "@/lib/content-hash";
import {
  assertAgentMaySetStatus,
  assertAgentOwnsItem,
} from "@/lib/agent-auth";
import {
  ALLOWED_DECISIONS_BY_KIND,
  USER_DECISION_STATUSES,
  type DecisionAction,
  type ItemKind,
  type ItemOption,
  type ItemRow,
  type ItemStatus,
} from "@/lib/types";
import { DECISION_STATUSES } from "@/lib/types";

export interface CreateItemInput {
  kind: ItemKind;
  project?: string;
  title: string;
  body?: string;
  options?: ItemOption[];
  due_at?: string | null;
  source_url?: string | null;
}

export interface PatchItemInput {
  project?: string;
  title?: string;
  body?: string;
  options?: ItemOption[];
  due_at?: string | null;
  source_url?: string | null;
  status?: ItemStatus;
  kind?: ItemKind;
}

export function buildNewItemFields(
  agentId: string,
  input: CreateItemInput,
  nowIso: string,
) {
  const title = input.title.trim();
  const body = (input.body ?? "").trim();
  const options = input.options ?? [];
  return {
    kind: input.kind,
    agent_id: agentId,
    project: input.project ?? "",
    title,
    body,
    options,
    due_at: input.due_at ?? null,
    source_url: input.source_url ?? null,
    status: "open" as const,
    content_hash: computeContentHash(title, body, options),
    created_at: nowIso,
    updated_at: nowIso,
    last_activity_at: nowIso,
  };
}

function contentChanged(
  item: ItemRow,
  title: string,
  body: string,
  options: ItemOption[],
): boolean {
  return (
    title !== item.title ||
    body !== item.body ||
    computeContentHash(title, body, options) !== item.content_hash
  );
}

export function applyAgentPatch(
  agentId: string,
  item: ItemRow,
  patch: PatchItemInput,
):
  | {
      ok: true;
      next: Partial<ItemRow> & { content_hash: string; status: ItemStatus };
      contentReopened: boolean;
    }
  | { ok: false; status: number; error: string } {
  const ownership = assertAgentOwnsItem(agentId, item.agent_id);
  if (!ownership.ok) {
    return { ok: false, status: 403, error: ownership.error };
  }

  const statusCheck = assertAgentMaySetStatus(patch.status);
  if (!statusCheck.ok) {
    return { ok: false, status: 403, error: statusCheck.error };
  }

  if (
    patch.kind !== undefined &&
    patch.kind !== item.kind &&
    USER_DECISION_STATUSES.has(item.status)
  ) {
    return {
      ok: false,
      status: 403,
      error: "cannot change kind after a user decision",
    };
  }

  const title = patch.title !== undefined ? patch.title.trim() : item.title;
  const body = patch.body !== undefined ? patch.body.trim() : item.body;
  const options = patch.options !== undefined ? patch.options : item.options;
  const reopened = contentChanged(item, title, body, options);

  const next: Partial<ItemRow> & { content_hash: string; status: ItemStatus } = {
    content_hash: computeContentHash(title, body, options),
    status: reopened ? "open" : (patch.status ?? item.status),
  };

  if (patch.title !== undefined) next.title = title;
  if (patch.body !== undefined) next.body = body;
  if (patch.options !== undefined) next.options = options;
  if (patch.project !== undefined) next.project = patch.project;
  if (patch.due_at !== undefined) next.due_at = patch.due_at;
  if (patch.source_url !== undefined) next.source_url = patch.source_url;
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (!reopened && patch.status !== undefined) next.status = patch.status;

  // 改内容后强制退回 open（覆盖姐妹同时传来的 status）
  if (reopened) {
    next.status = "open";
  }

  next.updated_at = new Date().toISOString();
  next.last_activity_at = next.updated_at;

  return { ok: true, next, contentReopened: reopened };
}

export function decisionToStatus(action: DecisionAction): ItemStatus {
  switch (action) {
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "reply":
      return "replied";
  }
}

export function assertDecisionAllowed(
  kind: ItemKind,
  action: DecisionAction,
  status: ItemStatus,
  optionKey: string | undefined,
  options: ItemOption[],
  expectedHash: string,
  currentHash: string,
): { ok: true } | { ok: false; error: string } {
  if (status !== "open") {
    return { ok: false, error: "item is not open" };
  }
  if (expectedHash !== currentHash) {
    return { ok: false, error: "content_hash mismatch" };
  }
  const allowed = ALLOWED_DECISIONS_BY_KIND[kind];
  if (!allowed.has(action)) {
    return { ok: false, error: "action not allowed for kind" };
  }
  if (optionKey !== undefined) {
    if (!options.some((o) => o.key === optionKey)) {
      return { ok: false, error: "invalid option_key" };
    }
  }
  return { ok: true };
}

export function itemHasFinalDecision(status: ItemStatus): boolean {
  return DECISION_STATUSES.has(status);
}
