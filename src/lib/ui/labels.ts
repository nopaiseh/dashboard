import type { ItemAction, ItemKind, ItemStatus } from "@/lib/types";

export const STATUS_LABELS: Record<ItemStatus, string> = {
  open: "未处理",
  approved: "已批准",
  rejected: "已驳回",
  replied: "已回复",
  done: "已完成",
  withdrawn: "已撤回",
};

export const KIND_LABELS: Record<ItemKind, string> = {
  approval: "待批",
  todo: "待办",
  question_to_user: "问你的",
  question_from_user: "你问的",
  waiting: "等别人",
};

export const ACTION_LABELS: Record<ItemAction, string> = {
  create: "新建",
  update: "更新",
  approve: "批准",
  reject: "驳回",
  reply: "回复",
  comment: "备注",
  withdraw: "撤回",
};

export const NAV_TABS = [
  { id: "today", href: "/", label: "今日", primary: true },
  { id: "pending", href: "/pending", label: "待批", kind: "approval" as const, primary: true },
  { id: "todo", href: "/todo", label: "待办", kind: "todo" as const, primary: true },
  {
    id: "qa-in",
    href: "/qa-in",
    label: "问你的",
    kind: "question_to_user" as const,
    primary: true,
  },
  {
    id: "qa-out",
    href: "/qa-out",
    label: "你问的",
    kind: "question_from_user" as const,
    primary: false,
  },
  { id: "waiting", href: "/waiting", label: "等别人", kind: "waiting" as const, primary: false },
  { id: "held", href: "/held", label: "搁置", primary: false },
  { id: "sisters", href: "/sisters", label: "姐妹", primary: false },
  { id: "goals", href: "/goals", label: "目标", primary: false },
  {
    id: "settings",
    href: "/settings/agents",
    label: "令牌",
    primary: false,
  },
] as const;

export type NavTabId = (typeof NAV_TABS)[number]["id"];

/** 从 pathname 推断顶栏高亮；错误边界与客户端壳共用。 */
export function navTabFromPathname(pathname: string): NavTabId {
  if (pathname.startsWith("/settings")) return "settings";
  if (pathname.startsWith("/sisters")) return "sisters";
  if (pathname.startsWith("/pending")) return "pending";
  if (pathname.startsWith("/todo")) return "todo";
  if (pathname.startsWith("/qa-in")) return "qa-in";
  if (pathname.startsWith("/qa-out")) return "qa-out";
  if (pathname.startsWith("/waiting")) return "waiting";
  if (pathname.startsWith("/held")) return "held";
  if (pathname.startsWith("/goals")) return "goals";
  return "today";
}

export const MOBILE_BOTTOM = [
  { id: "today", href: "/", label: "今日" },
  { id: "pending", href: "/pending", label: "待批" },
  { id: "qa", href: "/qa-in", label: "问答" },
  { id: "todo", href: "/todo", label: "待办" },
] as const;

export const INVALIDATED_APPROVAL_LABEL = "内容已变更，原批准已失效";
export const READ_PENDING_LABEL = "待姐妹读取";
export const READ_DONE_LABEL = "已读取";
export const LOCKOUT_MESSAGE = "尝试次数过多，请 15 分钟后再试";
export const ONE_BY_ONE_HINT = "一条一条批准";
