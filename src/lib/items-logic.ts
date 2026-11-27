import { randomUUID } from "node:crypto";
import {
  computeContentHash,
  matchesStoredContentHash,
  normalizeDueAt,
} from "@/lib/content-hash";
import {
  assertAgentMaySetStatus,
  assertAgentOwnsItem,
} from "@/lib/agent-auth";
import {
  ALLOWED_DECISIONS_BY_KIND,
  USER_DECISION_STATUSES,
  type DecisionAction,
  type ItemAction,
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

export interface AgentPatchPlan {
  expectedStatus: ItemStatus;
  expectedContentHash: string;
  newContentHash: string;
  /** 仅当需要改 status 时为 true（显式 patch 或内容重开） */
  setStatus: boolean;
  newStatus: ItemStatus | null;
  contentReopened: boolean;
  eventAction: ItemAction;
  fields: {
    title: string | null;
    body: string | null;
    options: ItemOption[] | null;
    project: string | null;
    due_at: string | null | undefined;
    source_url: string | null | undefined;
    kind: ItemKind | null;
  };
}

export function buildNewItemFields(
  agentId: string,
  input: CreateItemInput,
  nowIso: string,
  /** Pre-generated id so AAD can bind before insert. */
  itemId: string = randomUUID(),
) {
  const title = input.title.trim();
  const body = (input.body ?? "").trim();
  const options = input.options ?? [];
  const kind = input.kind;
  const due_at = normalizeDueAt(input.due_at ?? null);
  const source_url = input.source_url ?? null;
  return {
    id: itemId,
    kind,
    agent_id: agentId,
    project: input.project ?? "",
    title,
    body,
    options,
    due_at,
    source_url,
    status: "open" as const,
    content_hash: computeContentHash({
      kind,
      title,
      body,
      options,
      source_url,
      due_at,
    }),
    created_at: nowIso,
    updated_at: nowIso,
    last_activity_at: nowIso,
    result_read_at: null,
  };
}

function contentChanged(
  item: ItemRow,
  next: {
    kind: ItemKind;
    title: string;
    body: string;
    options: ItemOption[];
    source_url: string | null;
    due_at: string | null;
  },
): boolean {
  // Accept HMAC or legacy SHA during transition so patches don't false-reopen.
  return !matchesStoredContentHash(item.content_hash, next);
}

/**
 * 规划姐妹 PATCH：不回写「读到的旧 status」。
 * 仅在显式改 status 或内容变更重开时设置 setStatus。
 */
export function planAgentPatch(
  agentId: string,
  item: ItemRow,
  patch: PatchItemInput,
):
  | { ok: true; plan: AgentPatchPlan }
  | { ok: false; status: number; error: string } {
  const ownership = assertAgentOwnsItem(agentId, item.agent_id);
  if (!ownership.ok) {
    return { ok: false, status: 403, error: ownership.error };
  }

  const statusCheck = assertAgentMaySetStatus(
    patch.status,
    item.kind,
    item.status,
  );
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

  const contentFieldsPresent =
    patch.title !== undefined ||
    patch.body !== undefined ||
    patch.options !== undefined ||
    patch.kind !== undefined ||
    patch.source_url !== undefined ||
    patch.due_at !== undefined;

  if (contentFieldsPresent && patch.status === "withdrawn") {
    return {
      ok: false,
      status: 400,
      error: "cannot change content and withdraw in one request",
    };
  }

  const title = patch.title !== undefined ? patch.title.trim() : item.title;
  const body = patch.body !== undefined ? patch.body.trim() : item.body;
  const options = patch.options !== undefined ? patch.options : item.options;
  const kind = patch.kind !== undefined ? patch.kind : item.kind;
  const source_url =
    patch.source_url !== undefined ? patch.source_url : item.source_url;
  const due_at = normalizeDueAt(
    patch.due_at !== undefined ? patch.due_at : item.due_at,
  );

  const nextHashFields = {
    kind,
    title,
    body,
    options,
    source_url,
    due_at,
  };
  const reopened = contentChanged(item, nextHashFields);

  // 明文内容未变时保留库里原 hash（含过渡期旧 SHA），避免仅改状态就写新 HMAC
  // 导致历史批准事件被误判作废。
  const newContentHash = reopened
    ? computeContentHash(nextHashFields)
    : item.content_hash;

  let setStatus = false;
  let newStatus: ItemStatus | null = null;
  if (reopened) {
    setStatus = true;
    newStatus = "open";
  } else if (patch.status !== undefined) {
    setStatus = true;
    newStatus = patch.status;
  }

  let eventAction: ItemAction = "update";
  if (!reopened && patch.status === "withdrawn") {
    eventAction = "withdraw";
  }

  return {
    ok: true,
    plan: {
      expectedStatus: item.status,
      expectedContentHash: item.content_hash,
      newContentHash,
      setStatus,
      newStatus,
      contentReopened: reopened,
      eventAction,
      fields: {
        title: patch.title !== undefined ? title : null,
        body: patch.body !== undefined ? body : null,
        options: patch.options !== undefined ? options : null,
        project: patch.project !== undefined ? patch.project : null,
        due_at:
          patch.due_at !== undefined ? normalizeDueAt(patch.due_at) : undefined,
        source_url:
          patch.source_url !== undefined ? patch.source_url : undefined,
        kind: patch.kind !== undefined ? patch.kind : null,
      },
    },
  };
}

/** @deprecated 使用 planAgentPatch；保留别名供旧测试过渡 */
export function applyAgentPatch(
  agentId: string,
  item: ItemRow,
  patch: PatchItemInput,
):
  | {
      ok: true;
      next: Partial<ItemRow> & { content_hash: string };
      contentReopened: boolean;
      setStatus: boolean;
      newStatus: ItemStatus | null;
      eventAction: ItemAction;
      expectedStatus: ItemStatus;
      expectedContentHash: string;
    }
  | { ok: false; status: number; error: string } {
  const planned = planAgentPatch(agentId, item, patch);
  if (!planned.ok) {
    return planned;
  }
  const { plan } = planned;
  const next: Partial<ItemRow> & { content_hash: string } = {
    content_hash: plan.newContentHash,
  };
  if (plan.fields.title !== null) next.title = plan.fields.title;
  if (plan.fields.body !== null) next.body = plan.fields.body;
  if (plan.fields.options !== null) next.options = plan.fields.options;
  if (plan.fields.project !== null) next.project = plan.fields.project;
  if (plan.fields.due_at !== undefined) next.due_at = plan.fields.due_at;
  if (plan.fields.source_url !== undefined) {
    next.source_url = plan.fields.source_url;
  }
  if (plan.fields.kind !== null) next.kind = plan.fields.kind;
  if (plan.setStatus && plan.newStatus) {
    next.status = plan.newStatus;
  }
  return {
    ok: true,
    next,
    contentReopened: plan.contentReopened,
    setStatus: plan.setStatus,
    newStatus: plan.newStatus,
    eventAction: plan.eventAction,
    expectedStatus: plan.expectedStatus,
    expectedContentHash: plan.expectedContentHash,
  };
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
