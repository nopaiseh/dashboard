import type { ChartRangeMode } from "./types";

export type AccKey = "OA" | "SA" | "MA";
export type AccBalances = { OA: number; SA: number; MA: number };

export type CpfTodoItem = {
  title: string;
  sub: string;
  due: string;
  overdue?: boolean;
  info?: boolean;
  irreversible?: boolean;
};

export type CpfLedgerRow = {
  date: string;
  kind: "in" | "fee" | "out";
  typeLabel: string;
  note: string;
  OA: number | null;
  SA: number | null;
  MA: number | null;
  total: number;
};

export type CpfTrendPoint = {
  t: string;
  balances: AccBalances;
  phase: "actual" | "projected";
  grain: "month" | "year";
};

export type CpfTrendEvent = {
  t: string;
  kind: "employer_change" | "lump_sum";
  label: string;
  short?: string;
};

export type CpfConclusionData = {
  title: string;
  body: string;
  reachedFrs: boolean;
};

export type CpfAccountsData = {
  balances: AccBalances;
  chgM: AccBalances;
  chgY: AccBalances;
  asOf: string;
  monthContribTotal?: number;
  monthInterest?: number;
};

/** 三档状态文案由组件根据 reachedTier / 金额推导；此处只保留原始字段。 */
export type CpfProgressData = {
  ma: number;
  bhs: number;
  oaSa: number;
  brs: number;
  frs: number;
  ers: number;
  exceedFrs: number;
  /** 规范化后的 reached_tier（如 FRS）；缺省时组件按金额比较。 */
  reachedTier?: string;
  /** 下一档估算时间，如「2030 年 7 月」。 */
  nextEstimate?: string;
  /** MA→BHS 估算达成年月。 */
  hitBhs?: string;
};

export type CpfTrendData = {
  points12: CpfTrendPoint[];
  pointsAll: CpfTrendPoint[];
  events: CpfTrendEvent[];
  guides: Array<{ key: string; amount: number; label: string }>;
  janInterestAt?: string;
  janInterestTotal?: number;
  defaultRange: ChartRangeMode;
  subtitle12?: string;
  subtitleAll?: string;
};

export type CpfContribData = {
  OA: number;
  SA: number;
  MA: number;
  employer: number;
  self: number;
  total: number;
  annualLimit: number;
  paidYtd: number;
  limitLeft: number;
  asOfMonth: string;
  note?: string;
};

export type CpfAnnualData = {
  yearLabel: string;
  rates: { OA: string; SA: string; MA: string };
  /** 三个户口的利率 label 均缺省时隐藏「当年利率」列。 */
  showRates: boolean;
  interest: AccBalances;
  interestTotal: number;
  note?: string;
  rstuEmpty: boolean;
  rstuTitle?: string;
  rstuBody?: string;
  rstuExtra?: string;
  rstuDueChip?: string;
  /** 「已填补 S$ X」；有值时显示在 RSTU 标题右侧。 */
  rstuPaidLabel?: string;
  rstuPaidPositive?: boolean;
};

export type CpfAssumptionsData = {
  contribLine: string;
  contribDetail: string;
  rateLine: string;
  rateExtra: string;
  bullets: string[];
  byline: string;
};

/** C2 九段视图模型：缺段为 null → 组件显示空状态，绝不回落示例金额。 */
export type CpfViewModel = {
  conclusion: CpfConclusionData | null;
  accounts: CpfAccountsData | null;
  progress: CpfProgressData | null;
  trend: CpfTrendData | null;
  contrib: CpfContribData | null;
  annual: CpfAnnualData | null;
  todos: CpfTodoItem[] | null;
  ledger: CpfLedgerRow[] | null;
  ledgerSummary?: string;
  ledgerEmptyWithdrawals?: string;
  assumptions: CpfAssumptionsData | null;
};

export function emptyCpfViewModel(): CpfViewModel {
  return {
    conclusion: null,
    accounts: null,
    progress: null,
    trend: null,
    contrib: null,
    annual: null,
    todos: null,
    ledger: null,
    assumptions: null,
  };
}
