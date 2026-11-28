/** 银行看板配色与分组标签（设计 token，非示例金额）。 */
import type { BankAccountKey, BankGroup } from "@/lib/bank-block-keys";

export const BANK_GROUP_LABELS: Record<BankGroup, string> = {
  hub: "总闸",
  fixed: "固定支出",
  daily: "每日开销",
  savings: "储蓄",
  fx: "外币",
};

export const BANK_ACCOUNT_COLORS: Record<BankAccountKey, string> = {
  ocbc_salary: "#1b4332",
  hsbc: "#a9c9b6",
  trust: "#dcb77f",
  posb: "#dcb77f",
  ocbc_savings: "#2d5a47",
  gxs: "#2d5a47",
  wise: "#94a3b8",
};

export const BANK_PROJ_STROKE = "#a8742f";
export const BANK_ACTUAL_STROKE = "#2d5a47";

export const BANK_LEDGER_CATEGORY_LABELS: Record<string, string> = {
  salary: "工资",
  loan: "贷款还款",
  card: "信用卡还款",
  support: "对外资助",
  food: "餐饮",
  transport: "交通",
  subscription: "订阅",
  tax: "税务",
  gift: "人情",
  travel: "旅行",
  invest: "投资",
  other: "其他",
};

export const BANK_ALLOC_STATUS_LABELS: Record<
  "pending" | "partial" | "done" | "over",
  string
> = {
  done: "已拨",
  partial: "部分",
  over: "超拨",
  pending: "待拨",
};

export const BANK_TABS = [
  { id: "ov" as const, label: "概览" },
  { id: "goal" as const, label: "目标" },
  { id: "trend" as const, label: "趋势" },
  { id: "led" as const, label: "流水" },
];

export type BankTabId = (typeof BANK_TABS)[number]["id"];
