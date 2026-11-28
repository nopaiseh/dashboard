/**
 * 银行看板视图模型。金额只来自 parseBankModel；缺段为 null。
 * 禁止在此写入示例数字。
 */
import type { BankAccountKey, BankGroup } from "@/lib/bank-block-keys";
import type { ChartRangeMode } from "./types";

export type BankProgressKind =
  | "savings"
  | "floor"
  | "budget"
  | "streak"
  | "room";

export type BankProgressStatus =
  | "on_track"
  | "ahead"
  | "behind"
  | "no_target";

/** 进度 unit 白名单；其它字符串仅作展示数字兜底。 */
export type BankProgressUnit = "S$" | "月";

export type BankMilestone = {
  t: string;
  amount: number;
};

export type BankProgressItem = {
  key: string;
  title: string;
  accountKey: BankAccountKey;
  kind: BankProgressKind;
  value: number;
  target: number;
  /** 白名单 "S$" | "月"；白名单外只显示数字 */
  unit: BankProgressUnit | string;
  progress: number;
  monthlyNeeded?: number;
  due: string;
  status: BankProgressStatus;
  statusText: string;
  milestones: BankMilestone[];
  label: string;
  note: string;
};

export type BankAccountItem = {
  accountKey: BankAccountKey;
  name: string;
  roleTag: string;
  group: BankGroup;
  /** null = 缺数据 →「暂无数据」 */
  value: number | null;
  /** undefined = 首月无比对 →「—」；0 正常显示 */
  deltaMom?: number;
  ytd?: number;
  asOf: string;
  progress: BankProgressItem | null;
};

export type BankAccountGroup = {
  id: BankGroup;
  label: string;
  /** null = 组内全缺 */
  subtotal: number | null;
  accounts: BankAccountItem[];
};

export type BankConclusionData = {
  title: string;
  body: string;
  urgent: string | null;
};

export type BankNetData = {
  net: number;
  cashTotal: number;
  liabTotal: number;
  label: string;
};

export type BankLiabItem = {
  title: string;
  kind: "card_statement" | "grab_ledger" | "other";
  amount: number;
  due: string;
  estimated: boolean;
  note: string;
};

export type BankTodoItem = {
  title: string;
  sub: string;
  due: string;
  overdue?: boolean;
  info?: boolean;
  irreversible?: boolean;
};

export type BankAllocItem = {
  accountKey: BankAccountKey;
  label: string;
  planned: number;
  actual?: number;
  status: "pending" | "partial" | "done" | "over";
};

export type BankAllocData = {
  month: string;
  title: string;
  rows: BankAllocItem[];
};

export type BankTrendPoint = {
  t: string;
  v: number;
  phase: "actual" | "projected";
};

export type BankTrendSeries = {
  accountKey: BankAccountKey;
  title: string;
  points: BankTrendPoint[];
  defaultRange: ChartRangeMode;
};

export type BankLedgerLine = {
  kind: "in" | "out";
  category: string;
  amount: number;
};

export type BankLedgerMonth = {
  month: string;
  inTotal: number;
  outTotal: number;
  lines: BankLedgerLine[];
};

export type BankViewModel = {
  conclusion: BankConclusionData | null;
  net: BankNetData | null;
  groups: BankAccountGroup[];
  progress: BankProgressItem[];
  liab: BankLiabItem[] | null;
  todos: BankTodoItem[] | null;
  alloc: BankAllocData | null;
  trends: BankTrendSeries[];
  ledger: BankLedgerMonth[] | null;
  assumptions: string[] | null;
  asOf: string;
};

export function emptyBankViewModel(): BankViewModel {
  return {
    conclusion: null,
    net: null,
    groups: [],
    progress: [],
    liab: null,
    todos: null,
    alloc: null,
    trends: [],
    ledger: null,
    assumptions: null,
    asOf: "",
  };
}
