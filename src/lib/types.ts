export type ItemKind =
  | "approval"
  | "todo"
  | "question_to_user"
  | "question_from_user"
  | "waiting";

export type ItemStatus =
  | "open"
  | "approved"
  | "rejected"
  | "replied"
  | "done"
  | "withdrawn";

export type ItemAction =
  | "create"
  | "update"
  | "approve"
  | "reject"
  | "reply"
  | "comment"
  | "withdraw";

export type ActorType = "user" | "agent";

export type DecisionAction = "approve" | "reject" | "reply";

export interface ItemOption {
  key: string;
  label: string;
}

export interface ItemRow {
  id: string;
  kind: ItemKind;
  agent_id: string;
  project: string;
  title: string;
  body: string;
  options: ItemOption[];
  due_at: string | null;
  source_url: string | null;
  status: ItemStatus;
  content_hash: string;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
}

export interface ItemEventRow {
  id: string;
  item_id: string;
  actor_type: ActorType;
  agent_id: string | null;
  action: ItemAction;
  option_key: string | null;
  reply_text: string | null;
  credential_id: string | null;
  verified_at: string | null;
  content_hash: string | null;
  created_at: string;
}

export interface SessionPayload {
  sub: "owner";
  iat: number;
  lastActivity: number;
}

/** 姐妹可主动设置的状态（仅 done / withdrawn）。 */
export const AGENT_ALLOWED_STATUSES: ReadonlySet<ItemStatus> = new Set([
  "done",
  "withdrawn",
]);

/** 本人决定产生的状态。 */
export const USER_DECISION_STATUSES: ReadonlySet<ItemStatus> = new Set([
  "approved",
  "rejected",
  "replied",
]);

export const DECISION_STATUSES: ReadonlySet<ItemStatus> = new Set([
  "approved",
  "rejected",
  "replied",
  "done",
  "withdrawn",
]);

/** 各 kind 允许的本人决定动作。 */
export const ALLOWED_DECISIONS_BY_KIND: Record<
  ItemKind,
  ReadonlySet<DecisionAction>
> = {
  approval: new Set(["approve", "reject"]),
  todo: new Set(["reply"]),
  question_to_user: new Set(["reply"]),
  question_from_user: new Set(["reply"]),
  waiting: new Set(["reply"]),
};
