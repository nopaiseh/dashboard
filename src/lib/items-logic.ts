import { computeContentHash } from "@/lib/content-hash";
import {
  assertAgentMaySetStatus,
  assertAgentOwnsItem,
} from "@/lib/agent-auth";
import type {
  DecisionAction,
  ItemKind,
  ItemOption,
  ItemRow,
  ItemStatus,
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

export function applyAgentPatch(
  agentId: string,
  item: ItemRow,
  patch: PatchItemInput,
):
  | { ok: true; next: Partial<ItemRow> & { content_hash: string } }
  | { ok: false; status: number; error: string } {
  const ownership = assertAgentOwnsItem(agentId, item.agent_id);
  if (!ownership.ok) {
    return { ok: false, status: 403, error: ownership.error };
  }

  const statusCheck = assertAgentMaySetStatus(patch.status);
  if (!statusCheck.ok) {
    return { ok: false, status: 403, error: statusCheck.error };
  }

  const title = patch.title !== undefined ? patch.title.trim() : item.title;
  const body = patch.body !== undefined ? patch.body.trim() : item.body;
  const options = patch.options !== undefined ? patch.options : item.options;

  const next: Partial<ItemRow> & { content_hash: string } = {
    content_hash: computeContentHash(title, body, options),
  };

  if (patch.title !== undefined) next.title = title;
  if (patch.body !== undefined) next.body = body;
  if (patch.options !== undefined) next.options = options;
  if (patch.project !== undefined) next.project = patch.project;
  if (patch.due_at !== undefined) next.due_at = patch.due_at;
  if (patch.source_url !== undefined) next.source_url = patch.source_url;
  if (patch.kind !== undefined) next.kind = patch.kind;
  if (patch.status !== undefined) next.status = patch.status;

  next.updated_at = new Date().toISOString();
  next.last_activity_at = next.updated_at;

  return { ok: true, next };
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

export function itemHasFinalDecision(status: ItemStatus): boolean {
  return DECISION_STATUSES.has(status);
}
