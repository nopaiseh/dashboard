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
  waiting: "待回音",
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
  { id: "waiting", href: "/waiting", label: "待回音", kind: "waiting" as const, primary: true },
  { id: "held", href: "/held", label: "搁置", primary: false },
  { id: "agents", href: "/agents", label: "专员", primary: false },
] as const;

export type NavTabId = (typeof NAV_TABS)[number]["id"];

/** 从 pathname 推断顶栏高亮；错误边界与客户端壳共用。 */
export function navTabFromPathname(pathname: string): NavTabId {
  if (pathname.startsWith("/agents")) return "agents";
  if (pathname.startsWith("/pending")) return "pending";
  if (pathname.startsWith("/todo")) return "todo";
  if (pathname.startsWith("/waiting")) return "waiting";
  if (pathname.startsWith("/held")) return "held";
  // `/` overview and `/dashboard/[category]` detail both highlight 今日
  return "today";
}

export const MOBILE_BOTTOM = [
  { id: "today", href: "/", label: "今日" },
  { id: "pending", href: "/pending", label: "待批" },
  { id: "todo", href: "/todo", label: "待办" },
  { id: "waiting", href: "/waiting", label: "待回音" },
] as const;

export const INVALIDATED_APPROVAL_LABEL = "内容已变更，原批准已失效";
export const READ_PENDING_LABEL = "待专员读取";
export const READ_DONE_LABEL = "已读取";
export const LOCKOUT_MESSAGE = "尝试次数过多，请 15 分钟后再试";
export const ONE_BY_ONE_HINT = "一条一条批准";
