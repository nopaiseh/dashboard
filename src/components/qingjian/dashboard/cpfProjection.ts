import type { AccBalances, CpfTrendPoint } from "./cpfModel";

/** Default CPF ordinary / special / medisave annual rates (fraction). */
export const CPF_DEFAULT_RATES: AccBalances = {
  OA: 0.025,
  SA: 0.04,
  MA: 0.04,
};

const ACC_KEYS = ["OA", "SA", "MA"] as const;
const ZERO: AccBalances = { OA: 0, SA: 0, MA: 0 };

/** Parse labels like "2.5%" / "约 4%" → annual fraction; else null. */
export function parseRateLabel(label: string | undefined | null): number | null {
  if (!label) return null;
  const m = label.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const pct = Number(m[1]);
  return Number.isFinite(pct) ? pct / 100 : null;
}

export function resolveAnnualRates(rates?: {
  OA?: string;
  SA?: string;
  MA?: string;
}): AccBalances {
  return {
    OA: parseRateLabel(rates?.OA) ?? CPF_DEFAULT_RATES.OA,
    SA: parseRateLabel(rates?.SA) ?? CPF_DEFAULT_RATES.SA,
    MA: parseRateLabel(rates?.MA) ?? CPF_DEFAULT_RATES.MA,
  };
}

export function addMonthsYm(t: string, delta: number): string | null {
  const m = t.trim().match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 1 || mo > 12) {
    return null;
  }
  const idx = y * 12 + (mo - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function parseYm(t: string): { year: number; month: number } | null {
  const m = t.trim().match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function addBal(a: AccBalances, b: AccBalances): AccBalances {
  return {
    OA: a.OA + b.OA,
    SA: a.SA + b.SA,
    MA: a.MA + b.MA,
  };
}

function roundBal(b: AccBalances): AccBalances {
  return { OA: round2(b.OA), SA: round2(b.SA), MA: round2(b.MA) };
}

/**
 * Average month-over-month 「余额增幅」 from recent monthly actuals.
 * Excludes January deltas (they include the annual interest credit step).
 * Used only when an explicit contrib block is absent — not true 缴存.
 */
export function averageMonthlyBalanceGrowth(
  points: CpfTrendPoint[],
  lookback = 6,
): AccBalances {
  const monthly = points
    .filter((p) => p.phase === "actual" && p.grain === "month")
    .slice()
    .sort((a, b) => a.t.localeCompare(b.t));
  if (monthly.length < 2) return { ...ZERO };

  // Prefer the most recent lookback+1 points, then drop Jan-ending deltas.
  const window = monthly.slice(-(lookback + 1));
  const sum: AccBalances = { ...ZERO };
  let n = 0;
  for (let i = 1; i < window.length; i++) {
    const curT = parseYm(window[i]!.t);
    // Skip Dec→Jan / …→Jan steps: January balance includes year-end interest.
    if (curT?.month === 1) continue;
    const prev = window[i - 1]!.balances;
    const cur = window[i]!.balances;
    for (const k of ACC_KEYS) {
      sum[k] += cur[k] - prev[k];
    }
    n += 1;
  }
  if (n <= 0) return { ...ZERO };
  return {
    OA: sum.OA / n,
    SA: sum.SA / n,
    MA: sum.MA / n,
  };
}

/** @deprecated Use averageMonthlyBalanceGrowth — kept as alias for call sites. */
export const averageMonthlyContrib = averageMonthlyBalanceGrowth;

/**
 * Official extra-interest base for the first S$60k (under 55):
 * fill OA first (capped at S$20k), then SA, then MA — never scale
 * proportionally when the combined balance exceeds S$60k.
 */
export function extraInterestBase(bal: AccBalances): {
  oa: number;
  sa: number;
  ma: number;
} {
  let remaining = 60_000;
  const oa = Math.min(Math.max(0, bal.OA), 20_000, remaining);
  remaining -= oa;
  const sa = Math.min(Math.max(0, bal.SA), remaining);
  remaining -= sa;
  const ma = Math.min(Math.max(0, bal.MA), remaining);
  return { oa, sa, ma };
}

/**
 * Monthly interest accrual (not credited to balances yet).
 * Ordinary interest stays in each account; extra 1% on the first S$60k base
 * (OA→SA→MA fill order, OA capped at S$20k) — MA-derived extra stays in MA,
 * OA/SA-derived extra goes to SA (CPF rules for members under 55).
 */
export function monthlyInterestAccrual(
  bal: AccBalances,
  rates: AccBalances,
): AccBalances {
  const { oa: oaExtraBase, sa: saExtraBase, ma: maExtraBase } =
    extraInterestBase(bal);

  const ordinary: AccBalances = {
    OA: (bal.OA * rates.OA) / 12,
    SA: (bal.SA * rates.SA) / 12,
    MA: (bal.MA * rates.MA) / 12,
  };
  // Extra 1%/12: OA+SA share → SA; MA share → MA.
  const extraToSA = ((oaExtraBase + saExtraBase) * 0.01) / 12;
  const extraToMA = (maExtraBase * 0.01) / 12;

  return {
    OA: ordinary.OA,
    SA: ordinary.SA + extraToSA,
    MA: ordinary.MA + extraToMA,
  };
}

/**
 * MA above BHS may only top SA up to FRS; any remainder goes to OA.
 * Example: FRS 220k, SA 218k, overflow 5k → SA 220k and OA +3k.
 * This branch models members under 55 (55+ uses OA).
 */
export function applyMaOverflow(
  bal: AccBalances,
  bhs?: number,
  frs?: number,
): AccBalances {
  if (bhs == null || !Number.isFinite(bhs) || bhs <= 0 || bal.MA <= bhs) {
    return bal;
  }
  const overflow = bal.MA - bhs;
  const next = { ...bal, MA: bhs };
  if (frs == null || !Number.isFinite(frs) || frs <= 0) {
    // No FRS given → send all overflow to SA (under-55 default).
    next.SA += overflow;
    return next;
  }
  const roomInSa = Math.max(0, frs - next.SA);
  const toSa = Math.min(overflow, roomInSa);
  next.SA += toSa;
  next.OA += overflow - toSa;
  return next;
}

export type ProjectionInflowKind = "contrib" | "balance_growth";

/** Calendar-year BHS / FRS; used when a projection crosses 1 Jan. */
export type YearTargets = { bhs?: number; frs?: number };

export type StepProjectionOpts = {
  rates: AccBalances;
  /** Monthly inflow: true 缴存 amounts, or 「余额增幅」 fallback. */
  inflow: AccBalances;
  inflowKind?: ProjectionInflowKind;
  /** Default / starting-year BHS. */
  bhs?: number;
  /** Default / starting-year FRS. */
  frs?: number;
  /**
   * Per-calendar-year BHS/FRS. When projecting month YYYY-MM, targets for
   * YYYY win over the defaults above (CPF annual sums update each January).
   */
  targetsByYear?: Record<number, YearTargets>;
};

/** Resolve BHS/FRS for a calendar year (year map first, then defaults). */
export function resolveYearTargets(
  opts: Pick<StepProjectionOpts, "bhs" | "frs" | "targetsByYear">,
  year: number,
): YearTargets {
  const y = opts.targetsByYear?.[year];
  return {
    bhs: y?.bhs ?? opts.bhs,
    frs: y?.frs ?? opts.frs,
  };
}

/**
 * One projected month:
 * 1. If target month is January, credit the whole prior year's accrued interest
 *    (computed monthly, credited once — no monthly compounding).
 * 2. Add monthly inflow.
 * 3. Apply MA→SA/OA overflow (under-55 rules).
 * 4. Accrue this month's interest into the running accrual (not into balances).
 */
export function stepProjectedMonth(
  bal: AccBalances,
  accrued: AccBalances,
  targetYm: string,
  opts: StepProjectionOpts,
): { balances: AccBalances; accrued: AccBalances } {
  const ym = parseYm(targetYm);
  let nextBal = { ...bal };
  let nextAccrued = { ...accrued };

  // Dec→Jan boundary: credit the prior calendar year's accrued interest at once.
  if (ym?.month === 1) {
    nextBal = addBal(nextBal, nextAccrued);
    nextAccrued = { ...ZERO };
  }

  nextBal = addBal(nextBal, opts.inflow);
  // Use this calendar year's BHS/FRS when the projection crosses 1 Jan.
  const yearTargets = ym
    ? resolveYearTargets(opts, ym.year)
    : { bhs: opts.bhs, frs: opts.frs };
  nextBal = applyMaOverflow(nextBal, yearTargets.bhs, yearTargets.frs);

  const monthInterest = monthlyInterestAccrual(nextBal, opts.rates);
  nextAccrued = addBal(nextAccrued, monthInterest);

  return {
    balances: roundBal(nextBal),
    accrued: nextAccrued,
  };
}

/**
 * Accrue interest for actual months in `year` up through `throughMonth`
 * (inclusive), using each month's ending balances. If those months are not
 * present in `actuals`, returns zeros — assumption: YTD accrual starts at 0
 * when prior months of the year are not derivable from the series.
 */
export function accrueFromActualMonths(
  actuals: CpfTrendPoint[],
  year: number,
  throughMonth: number,
  rates: AccBalances,
): AccBalances {
  const byT = new Map(
    actuals
      .filter((p) => p.phase === "actual" && p.grain === "month")
      .map((p) => [p.t, p]),
  );
  let accrued = { ...ZERO };
  for (let m = 1; m <= throughMonth; m++) {
    const t = `${year}-${String(m).padStart(2, "0")}`;
    const pt = byT.get(t);
    if (!pt) {
      // Missing month: cannot derive; leave that month's accrual as 0.
      continue;
    }
    accrued = addBal(accrued, monthlyInterestAccrual(pt.balances, rates));
  }
  return accrued;
}

/** Project `months` points after the last actual monthly balance. */
export function projectNextMonths(
  last: CpfTrendPoint,
  months: number,
  opts: StepProjectionOpts & {
    /** Actual monthly points used to seed YTD interest accrual. */
    actualsForAccrual?: CpfTrendPoint[];
  },
): CpfTrendPoint[] {
  const out: CpfTrendPoint[] = [];
  let bal = { ...last.balances };
  const lastYm = parseYm(last.t);

  // Seed accrued interest for the current calendar year from actual months
  // already observed (Jan … last month). If those months are missing, accrual
  // starts at 0 (documented assumption above).
  let accrued =
    lastYm && opts.actualsForAccrual
      ? accrueFromActualMonths(
          opts.actualsForAccrual,
          lastYm.year,
          lastYm.month,
          opts.rates,
        )
      : { ...ZERO };

  for (let i = 1; i <= months; i++) {
    const t = addMonthsYm(last.t, i);
    if (!t) break;
    const stepped = stepProjectedMonth(bal, accrued, t, opts);
    bal = stepped.balances;
    accrued = stepped.accrued;
    out.push({
      t,
      balances: { ...bal },
      phase: "projected",
      grain: "month",
    });
  }
  return out;
}

/**
 * Ensure a series ends with up to `months` projected points after the last
 * actual. Prefer existing projected samples in `source` for those months;
 * fill any gap by projecting from the last actual.
 */
export function withNearTermProjection(
  points: CpfTrendPoint[],
  source: CpfTrendPoint[],
  months = 6,
  opts?: {
    rates?: AccBalances;
    /** Explicit monthly 缴存; when absent, fall back to 「余额增幅」. */
    contrib?: AccBalances;
    bhs?: number;
    frs?: number;
    targetsByYear?: Record<number, YearTargets>;
  },
): CpfTrendPoint[] {
  const actuals = points.filter((p) => p.phase === "actual");
  if (actuals.length === 0) return points;

  const monthlyActuals = source.filter(
    (p) => p.phase === "actual" && p.grain === "month",
  );

  const lastActual =
    [...actuals]
      .filter((p) => p.grain === "month")
      .sort((a, b) => a.t.localeCompare(b.t))
      .at(-1) ?? [...actuals].sort((a, b) => a.t.localeCompare(b.t)).at(-1)!;

  const wantTimes = new Set<string>();
  for (let i = 1; i <= months; i++) {
    const t = addMonthsYm(lastActual.t, i);
    if (t) wantTimes.add(t);
  }
  if (wantTimes.size === 0) return actuals;

  const fromSource = source
    .filter((p) => p.phase === "projected" && wantTimes.has(p.t))
    .sort((a, b) => a.t.localeCompare(b.t));

  if (fromSource.length >= months) {
    return [...actuals, ...fromSource.slice(0, months)];
  }

  const rates = opts?.rates ?? CPF_DEFAULT_RATES;
  const hasContrib =
    opts?.contrib != null &&
    ACC_KEYS.some((k) => Number.isFinite(opts.contrib![k]));
  const inflow = hasContrib
    ? opts!.contrib!
    : averageMonthlyBalanceGrowth(monthlyActuals);
  const inflowKind: ProjectionInflowKind = hasContrib
    ? "contrib"
    : "balance_growth";

  const computed = projectNextMonths(lastActual, months, {
    rates,
    inflow,
    inflowKind,
    bhs: opts?.bhs,
    frs: opts?.frs,
    targetsByYear: opts?.targetsByYear,
    actualsForAccrual: monthlyActuals,
  });

  const byT = new Map(computed.map((p) => [p.t, p]));
  for (const p of fromSource) byT.set(p.t, p);
  const merged = [...wantTimes]
    .sort()
    .map((t) => byT.get(t))
    .filter((p): p is CpfTrendPoint => p != null);

  return [...actuals, ...merged];
}

/** Resolve inflow for chart wiring: explicit contrib or 「余额增幅」. */
export function resolveProjectionInflow(
  contrib: AccBalances | undefined,
  monthlyActuals: CpfTrendPoint[],
): { inflow: AccBalances; kind: ProjectionInflowKind } {
  if (
    contrib != null &&
    ACC_KEYS.some((k) => Number.isFinite(contrib[k]) && contrib[k] !== 0)
  ) {
    return { inflow: contrib, kind: "contrib" };
  }
  if (contrib != null && ACC_KEYS.every((k) => Number.isFinite(contrib[k]))) {
    return { inflow: contrib, kind: "contrib" };
  }
  return {
    inflow: averageMonthlyBalanceGrowth(monthlyActuals),
    kind: "balance_growth",
  };
}
