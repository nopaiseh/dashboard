/**
 * 从真实 dashboard section blocks 解析 C2 视图模型。
 * 不引用任何示例数字模块；缺字段 → 对应段为 null（空状态）。
 */
import type {
  DashboardBlockPublic,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";
import { isSensitivePayloadKey } from "./format";
import {
  emptyCpfViewModel,
  type AccBalances,
  type CpfAnnualData,
  type CpfAssumptionsData,
  type CpfAccountsData,
  type CpfConclusionData,
  type CpfContribData,
  type CpfLedgerRow,
  type CpfProgressData,
  type CpfTodoItem,
  type CpfTrendData,
  type CpfTrendEvent,
  type CpfTrendPoint,
  type CpfViewModel,
} from "./cpfModel";

function clean(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (isSensitivePayloadKey(k)) continue;
    out[k] = v;
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function roleOf(block: DashboardBlockPublic): string {
  const p = clean(block.payload);
  return (str(p.role) ?? str(p.layout) ?? "").trim();
}

function findByRole(
  blocks: DashboardBlockPublic[],
  roles: string[],
): DashboardBlockPublic | undefined {
  const set = new Set(roles);
  return blocks.find((b) => set.has(roleOf(b)));
}

function parseBalances(raw: unknown): AccBalances | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const OA = num(r.OA) ?? num(r.oa);
  const SA = num(r.SA) ?? num(r.sa);
  const MA = num(r.MA) ?? num(r.ma);
  if (OA === undefined || SA === undefined || MA === undefined) return null;
  return { OA, SA, MA };
}

function parseConclusion(
  blocks: DashboardBlockPublic[],
  pageHeadline: string,
): CpfConclusionData | null {
  const b =
    findByRole(blocks, ["c2_layout", "c2", "cpf_conclusion"]) ??
    blocks.find((x) => x.block_type === "headline");
  if (!b) {
    const title = pageHeadline.trim();
    return title ? { title, body: "", reachedFrs: false } : null;
  }
  const p = clean(b.payload);
  const title =
    str(p.title)?.trim() ||
    (b.block_type === "headline" ? str(p.text)?.trim() : undefined) ||
    pageHeadline.trim();
  if (!title) return null;
  const body =
    b.block_type === "headline"
      ? ""
      : (str(p.text)?.trim() ?? str(p.body)?.trim() ?? "");
  const reachedFrs =
    bool(p.reached_frs) ??
    bool(p.reachedFrs) ??
    (str(p.status) === "reached_frs" || str(p.status) === "frs");
  return { title, body, reachedFrs: reachedFrs === true };
}

function parseAccounts(blocks: DashboardBlockPublic[]): CpfAccountsData | null {
  const b = findByRole(blocks, ["cpf_accounts", "accounts"]);
  if (!b) return null;
  const p = clean(b.payload);
  const balances = parseBalances(p.balances ?? p);
  if (!balances) return null;
  const zero = { OA: 0, SA: 0, MA: 0 };
  return {
    balances,
    chgM: parseBalances(p.chg_m ?? p.chgM) ?? zero,
    chgY: parseBalances(p.chg_y ?? p.chgY) ?? zero,
    asOf: str(p.as_of)?.trim() || str(p.asOf)?.trim() || "",
    monthContribTotal: num(p.month_contrib_total) ?? num(p.monthContribTotal),
    monthInterest: num(p.month_interest) ?? num(p.monthInterest),
  };
}

function parseProgress(blocks: DashboardBlockPublic[]): CpfProgressData | null {
  const b = findByRole(blocks, ["cpf_progress", "progress_targets"]);
  if (!b) return null;
  const p = clean(b.payload);
  const ma = num(p.ma) ?? num(p.MA);
  const bhs = num(p.bhs) ?? num(p.BHS);
  const oaSa = num(p.oa_sa) ?? num(p.oaSa) ?? num(p.value);
  const brs = num(p.brs) ?? num(p.BRS);
  const frs = num(p.frs) ?? num(p.FRS);
  const ers = num(p.ers) ?? num(p.ERS);
  if (
    ma === undefined ||
    bhs === undefined ||
    oaSa === undefined ||
    brs === undefined ||
    frs === undefined ||
    ers === undefined
  ) {
    return null;
  }
  const exceedFrs =
    num(p.exceed_frs) ?? num(p.exceedFrs) ?? Math.max(0, oaSa - frs);
  return {
    ma,
    bhs,
    oaSa,
    brs,
    frs,
    ers,
    exceedFrs,
    hitBhs: str(p.hit_bhs) ?? str(p.hitBhs),
    hitBrs: str(p.hit_brs) ?? str(p.hitBrs),
    hitFrs: str(p.hit_frs) ?? str(p.hitFrs),
    hitErs: str(p.hit_ers) ?? str(p.hitErs),
    footnote: str(p.footnote) ?? str(p.note),
  };
}

function parseTrendPoint(raw: unknown): CpfTrendPoint | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const t = str(r.t)?.trim();
  const balances = parseBalances(r.balances ?? r);
  if (!t || !balances) return null;
  const phaseRaw = str(r.phase);
  const phase = phaseRaw === "projected" ? "projected" : "actual";
  const grainRaw = str(r.grain);
  const grain =
    grainRaw === "year" || grainRaw === "month"
      ? grainRaw
      : /^\d{4}$/.test(t)
        ? "year"
        : "month";
  return { t, balances, phase, grain };
}

function parseTrend(blocks: DashboardBlockPublic[]): CpfTrendData | null {
  const b = findByRole(blocks, ["cpf_trend", "chart_series", "trend"]);
  if (!b) return null;
  const p = clean(b.payload);
  const points12 = Array.isArray(p.points_12m)
    ? (p.points_12m.map(parseTrendPoint).filter(Boolean) as CpfTrendPoint[])
    : Array.isArray(p.points12)
      ? (p.points12.map(parseTrendPoint).filter(Boolean) as CpfTrendPoint[])
      : [];
  const pointsAll = Array.isArray(p.points_all)
    ? (p.points_all.map(parseTrendPoint).filter(Boolean) as CpfTrendPoint[])
    : Array.isArray(p.pointsAll)
      ? (p.pointsAll.map(parseTrendPoint).filter(Boolean) as CpfTrendPoint[])
      : [];
  if (points12.length === 0 && pointsAll.length === 0) return null;

  const events: CpfTrendEvent[] = [];
  if (Array.isArray(p.events)) {
    for (const item of p.events) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const t = str(e.t)?.trim();
      const kindRaw = str(e.kind) ?? str(e.type) ?? "";
      if (!t || !kindRaw) continue;
      const kind =
        kindRaw === "lump_sum" || kindRaw === "lump-sum" || kindRaw === "flag"
          ? "lump_sum"
          : "employer_change";
      events.push({
        t,
        kind,
        label: str(e.label) ?? (kind === "lump_sum" ? "一次性转入" : "换雇主"),
        short: str(e.short),
      });
    }
  }

  const guides: CpfTrendData["guides"] = [];
  if (Array.isArray(p.guides)) {
    for (const item of p.guides) {
      if (!item || typeof item !== "object") continue;
      const g = item as Record<string, unknown>;
      const key = str(g.key) ?? str(g.label);
      const amount = num(g.amount) ?? num(g.value);
      const label = str(g.label) ?? key;
      if (!key || amount === undefined || !label) continue;
      guides.push({ key, amount, label });
    }
  }

  const rangeRaw = str(p.range_default) ?? str(p.defaultRange);
  return {
    points12,
    pointsAll: pointsAll.length ? pointsAll : points12,
    events,
    guides,
    janInterestAt: str(p.jan_interest_at) ?? str(p.janInterestAt),
    janInterestTotal: num(p.jan_interest_total) ?? num(p.janInterestTotal),
    defaultRange: rangeRaw === "all" ? "all" : "12m",
    subtitle12: str(p.subtitle_12m) ?? str(p.subtitle12),
    subtitleAll: str(p.subtitle_all) ?? str(p.subtitleAll),
  };
}

function parseContrib(blocks: DashboardBlockPublic[]): CpfContribData | null {
  const b = findByRole(blocks, ["cpf_contrib", "monthly_contrib"]);
  if (!b) return null;
  const p = clean(b.payload);
  const OA = num(p.OA) ?? num(p.oa);
  const SA = num(p.SA) ?? num(p.sa);
  const MA = num(p.MA) ?? num(p.ma);
  const employer = num(p.employer);
  const self = num(p.self);
  const total = num(p.total) ?? (OA !== undefined && SA !== undefined && MA !== undefined ? OA + SA + MA : undefined);
  const annualLimit = num(p.annual_limit) ?? num(p.annualLimit);
  const paidYtd = num(p.paid_ytd) ?? num(p.paidYtd);
  const limitLeft = num(p.limit_left) ?? num(p.limitLeft);
  if (
    OA === undefined ||
    SA === undefined ||
    MA === undefined ||
    employer === undefined ||
    self === undefined ||
    total === undefined ||
    annualLimit === undefined ||
    paidYtd === undefined ||
    limitLeft === undefined
  ) {
    return null;
  }
  return {
    OA,
    SA,
    MA,
    employer,
    self,
    total,
    annualLimit,
    paidYtd,
    limitLeft,
    asOfMonth: str(p.as_of_month)?.trim() || str(p.asOfMonth)?.trim() || "",
    note: str(p.note),
  };
}

function parseAnnual(blocks: DashboardBlockPublic[]): CpfAnnualData | null {
  const b = findByRole(blocks, ["cpf_annual", "annual"]);
  if (!b) return null;
  const p = clean(b.payload);
  const interest = parseBalances(p.interest ?? p.interest_by);
  const interestTotal = num(p.interest_total) ?? num(p.interestTotal);
  if (!interest || interestTotal === undefined) return null;
  const rates = (p.rates && typeof p.rates === "object"
    ? (p.rates as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  return {
    yearLabel: str(p.year_label)?.trim() || str(p.yearLabel)?.trim() || "年度利息",
    rates: {
      OA: str(rates.OA) ?? str(rates.oa) ?? "—",
      SA: str(rates.SA) ?? str(rates.sa) ?? "—",
      MA: str(rates.MA) ?? str(rates.ma) ?? "—",
    },
    interest,
    interestTotal,
    note: str(p.note),
    rstuEmpty: bool(p.rstu_empty) ?? bool(p.rstuEmpty) ?? true,
    rstuTitle: str(p.rstu_title) ?? str(p.rstuTitle),
    rstuBody: str(p.rstu_body) ?? str(p.rstuBody),
    rstuExtra: str(p.rstu_extra) ?? str(p.rstuExtra),
    rstuDueChip: str(p.rstu_due_chip) ?? str(p.rstuDueChip),
  };
}

function parseTodos(blocks: DashboardBlockPublic[]): CpfTodoItem[] | null {
  const b = findByRole(blocks, ["cpf_todos", "todos"]);
  if (!b) return null;
  const p = clean(b.payload);
  if (!Array.isArray(p.items)) return null;
  const items: CpfTodoItem[] = [];
  for (const item of p.items) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const title = str(r.title)?.trim();
    if (!title) continue;
    items.push({
      title,
      sub: str(r.sub)?.trim() ?? "",
      due: str(r.due)?.trim() ?? "",
      overdue: bool(r.overdue),
      info: bool(r.info),
      irreversible: bool(r.irreversible),
    });
  }
  return items;
}

function parseLedger(blocks: DashboardBlockPublic[]): {
  rows: CpfLedgerRow[] | null;
  summary?: string;
  emptyWithdrawals?: string;
} {
  const b = findByRole(blocks, ["cpf_ledger", "ledger"]);
  if (!b) return { rows: null };
  const p = clean(b.payload);
  if (!Array.isArray(p.rows) && !Array.isArray(p.items)) {
    return {
      rows: [],
      summary: str(p.summary),
      emptyWithdrawals: str(p.empty_withdrawals) ?? str(p.emptyWithdrawals),
    };
  }
  const raw = (Array.isArray(p.rows) ? p.rows : p.items) as unknown[];
  const rows: CpfLedgerRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const date = str(r.date)?.trim();
    const kindRaw = str(r.kind) ?? "in";
    const kind =
      kindRaw === "fee" || kindRaw === "out" ? kindRaw : "in";
    if (!date) continue;
    const cell = (k: string) => {
      const v = r[k];
      if (v === null) return null;
      return num(v) ?? null;
    };
    rows.push({
      date,
      kind,
      typeLabel: str(r.type_label) ?? str(r.typeLabel) ?? (kind === "in" ? "＋ 缴存" : "－ 扣款"),
      note: str(r.note)?.trim() ?? "",
      OA: cell("OA") ?? cell("oa"),
      SA: cell("SA") ?? cell("sa"),
      MA: cell("MA") ?? cell("ma"),
      total: num(r.total) ?? 0,
    });
  }
  return {
    rows,
    summary: str(p.summary),
    emptyWithdrawals: str(p.empty_withdrawals) ?? str(p.emptyWithdrawals),
  };
}

function parseAssumptions(
  blocks: DashboardBlockPublic[],
): CpfAssumptionsData | null {
  const b = findByRole(blocks, ["cpf_assumptions", "assumptions"]);
  if (!b) return null;
  const p = clean(b.payload);
  const bullets = Array.isArray(p.bullets)
    ? p.bullets.filter((x): x is string => typeof x === "string")
    : [];
  const contribLine = str(p.contrib_line) ?? str(p.contribLine);
  const rateLine = str(p.rate_line) ?? str(p.rateLine);
  if (!contribLine || !rateLine) return null;
  return {
    contribLine,
    contribDetail: str(p.contrib_detail) ?? str(p.contribDetail) ?? "",
    rateLine,
    rateExtra: str(p.rate_extra) ?? str(p.rateExtra) ?? "",
    bullets,
    byline: str(p.byline) ?? "",
  };
}

/** 仅根据 API 分区数据组装；缺段保持 null。 */
export function parseCpfModel(
  section: DashboardSectionPublic,
  pageHeadline = "",
): CpfViewModel {
  const model = emptyCpfViewModel();
  const blocks = section.blocks;
  model.conclusion = parseConclusion(blocks, pageHeadline);
  model.accounts = parseAccounts(blocks);
  model.progress = parseProgress(blocks);
  model.trend = parseTrend(blocks);
  model.contrib = parseContrib(blocks);
  model.annual = parseAnnual(blocks);
  model.todos = parseTodos(blocks);
  const ledger = parseLedger(blocks);
  model.ledger = ledger.rows;
  model.ledgerSummary = ledger.summary;
  model.ledgerEmptyWithdrawals = ledger.emptyWithdrawals;
  model.assumptions = parseAssumptions(blocks);
  return model;
}
