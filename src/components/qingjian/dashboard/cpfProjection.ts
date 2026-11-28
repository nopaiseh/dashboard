import type { AccBalances, CpfTrendPoint } from "./cpfModel";

/** Default CPF ordinary / special / medisave annual rates (fraction). */
export const CPF_DEFAULT_RATES: AccBalances = {
  OA: 0.025,
  SA: 0.04,
  MA: 0.04,
};

const ACC_KEYS = ["OA", "SA", "MA"] as const;

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

function addMonthsYm(t: string, delta: number): string | null {
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

/**
 * Average month-over-month balance change from recent monthly actuals.
 * Used as monthly contribution proxy when an explicit contrib block is absent.
 */
export function averageMonthlyContrib(
  points: CpfTrendPoint[],
  lookback = 6,
): AccBalances {
  const monthly = points
    .filter((p) => p.phase === "actual" && p.grain === "month")
    .slice()
    .sort((a, b) => a.t.localeCompare(b.t));
  if (monthly.length < 2) return { OA: 0, SA: 0, MA: 0 };

  const window = monthly.slice(-(lookback + 1));
  const n = window.length - 1;
  if (n <= 0) return { OA: 0, SA: 0, MA: 0 };

  const sum: AccBalances = { OA: 0, SA: 0, MA: 0 };
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1]!.balances;
    const cur = window[i]!.balances;
    for (const k of ACC_KEYS) {
      sum[k] += cur[k] - prev[k];
    }
  }
  return {
    OA: sum.OA / n,
    SA: sum.SA / n,
    MA: sum.MA / n,
  };
}

/**
 * One month of CPF-style estimate: monthly compounding at account rates,
 * plus extra 1% / 12 on the first S$60k base (OA capped at 20k + SA + MA),
 * plus monthly contribution; MA above BHS overflows into SA.
 * Mirrors the sample `c2_model.project` step (without inventing insurance fees).
 */
export function stepProjectedBalances(
  bal: AccBalances,
  rates: AccBalances,
  contrib: AccBalances,
  bhs?: number,
): AccBalances {
  const extraBase = Math.min(
    60_000,
    Math.min(bal.OA, 20_000) + bal.SA + bal.MA,
  );
  const next: AccBalances = {
    OA: bal.OA * (1 + rates.OA / 12) + contrib.OA,
    SA: bal.SA * (1 + rates.SA / 12) + contrib.SA + (extraBase * 0.01) / 12,
    MA: bal.MA * (1 + rates.MA / 12) + contrib.MA,
  };
  if (bhs != null && Number.isFinite(bhs) && bhs > 0 && next.MA > bhs) {
    next.SA += next.MA - bhs;
    next.MA = bhs;
  }
  return {
    OA: Math.round(next.OA * 100) / 100,
    SA: Math.round(next.SA * 100) / 100,
    MA: Math.round(next.MA * 100) / 100,
  };
}

/** Project `months` points after the last actual monthly balance. */
export function projectNextMonths(
  last: CpfTrendPoint,
  months: number,
  opts: {
    rates: AccBalances;
    contrib: AccBalances;
    bhs?: number;
  },
): CpfTrendPoint[] {
  const out: CpfTrendPoint[] = [];
  let bal = { ...last.balances };
  for (let i = 1; i <= months; i++) {
    const t = addMonthsYm(last.t, i);
    if (!t) break;
    bal = stepProjectedBalances(bal, opts.rates, opts.contrib, opts.bhs);
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
 * fill any gap by compounding from the last actual.
 */
export function withNearTermProjection(
  points: CpfTrendPoint[],
  source: CpfTrendPoint[],
  months = 6,
  opts?: {
    rates?: AccBalances;
    contrib?: AccBalances;
    bhs?: number;
  },
): CpfTrendPoint[] {
  const actuals = points.filter((p) => p.phase === "actual");
  if (actuals.length === 0) return points;

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
  const contrib =
    opts?.contrib ??
    averageMonthlyContrib(
      source.filter((p) => p.phase === "actual" && p.grain === "month"),
    );
  const computed = projectNextMonths(lastActual, months, {
    rates,
    contrib,
    bhs: opts?.bhs,
  });

  // Prefer source values when present for a month; else computed.
  const byT = new Map(computed.map((p) => [p.t, p]));
  for (const p of fromSource) byT.set(p.t, p);
  const merged = [...wantTimes]
    .sort()
    .map((t) => byT.get(t))
    .filter((p): p is CpfTrendPoint => p != null);

  return [...actuals, ...merged];
}
