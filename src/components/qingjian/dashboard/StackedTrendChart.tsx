"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { EmptyBlock } from "./EmptyBlock";
import type { AccBalances, CpfTrendData, CpfTrendPoint } from "./cpfModel";
import { CPF_COLORS } from "./cpfTheme";
import { formatMoney, parseTrendPointTime } from "./format";
import type { ChartRangeMode } from "./types";

/** Evenly pick ~`count` indices from `length` points (inclusive ends). */
export function pickEvenIndices(length: number, count = 5): number[] {
  if (length <= 0) return [];
  if (length === 1) return [0];
  const ticks = Math.min(Math.max(1, count), length);
  if (ticks === 1) return [0];
  const out: number[] = [];
  for (let k = 0; k < ticks; k++) {
    out.push(Math.round((k * (length - 1)) / (ticks - 1)));
  }
  return [...new Set(out)];
}

/**
 * X positions on a linear time scale between the series min/max dates.
 * Single-point / zero-span / empty → no NaN (center, index fallback, or padLeft).
 */
export function xPositionsForDates(
  times: Array<number | null>,
  padLeft: number,
  innerW: number,
): number[] {
  const n = times.length;
  if (n === 0) return [];
  if (n === 1) return [padLeft + innerW / 2];

  const valid = times.filter((t): t is number => t != null && Number.isFinite(t));
  const tMin = valid.length ? Math.min(...valid) : NaN;
  const tMax = valid.length ? Math.max(...valid) : NaN;
  const tSpan = tMax - tMin;

  if (!Number.isFinite(tSpan) || tSpan === 0) {
    const denom = Math.max(1, n - 1);
    return times.map((_, i) => padLeft + (i / denom) * innerW);
  }

  const denom = Math.max(1, n - 1);
  return times.map((t, i) => {
    if (t == null || !Number.isFinite(t)) {
      return padLeft + (i / denom) * innerW;
    }
    return padLeft + ((t - tMin) / tSpan) * innerW;
  });
}

/** Month axis labels from real point dates (e.g. 2026-01 → 「1月」). */
export function buildTwelveMonthXLabels(
  points: Array<{ t: string }>,
  tickCount = 5,
): Array<{ i: number; label: string }> {
  if (points.length === 0) return [];
  const indices = pickEvenIndices(points.length, tickCount);
  const years = new Set(
    points
      .map((p) => {
        const m = p.t.trim().match(/^(\d{4})/);
        return m ? m[1] : null;
      })
      .filter((y): y is string => y != null),
  );
  const multiYear = years.size > 1;
  let prevYear: string | null = null;
  return indices.map((i) => {
    const raw = points[i]?.t.trim() ?? "";
    const match = raw.match(/^(\d{4})(?:-(\d{2}))?/);
    if (!match) return { i, label: raw };
    const year = match[1]!;
    const month = match[2] ? String(Number(match[2])) : "12";
    let label = `${month}月`;
    if (multiYear && (prevYear === null || year !== prevYear)) {
      label = `${year}年${month}月`;
    }
    prevYear = year;
    return { i, label };
  });
}

/**
 * Sort trend points by month-end time for drawing order.
 * On equal timestamps, year (年底数) is drawn LAST so it is the top hover/focus target.
 */
export function sortTrendPointsByTime(
  points: CpfTrendPoint[],
): CpfTrendPoint[] {
  return [...points].sort((a, b) => {
    const ta = parseTrendPointTime(a.t);
    const tb = parseTrendPointTime(b.t);
    const aKey =
      ta == null || !Number.isFinite(ta) ? Number.POSITIVE_INFINITY : ta;
    const bKey =
      tb == null || !Number.isFinite(tb) ? Number.POSITIVE_INFINITY : tb;
    if (aKey !== bKey) return aKey - bKey;
    if (a.grain !== b.grain) {
      if (a.grain === "year") return 1;
      if (b.grain === "year") return -1;
    }
    return a.t.localeCompare(b.t);
  });
}

/** Year-end instant matching `parseTrendPointTime("YYYY")` (Dec 31, +08). */
export function yearEndMs(year: number): number {
  return parseTrendPointTime(String(year)) ?? NaN;
}

/** Calendar year in the same +08 zone used by `parseTrendPointTime`. */
function calendarYearAt(ms: number): number {
  return Number(
    new Date(ms + 8 * 60 * 60 * 1000).toISOString().slice(0, 4),
  );
}

export type YearXTick = {
  year: number;
  label: string;
  /** Pixel x on the same linear date scale as `xPositionsForDates`. */
  x: number;
  /** Year-end timestamp used for placement. */
  t: number;
};

/**
 * Year axis ticks for 「全部」: every `step` years (default 2; adapts up so
 * labels keep ~minLabelGapPx in SVG space — enough for mobile 390px), each
 * anchored at year-end and clipped to [tMin, tMax].
 */
export function buildYearXTicks(
  tMin: number,
  tMax: number,
  padLeft: number,
  innerW: number,
  opts?: { step?: number; minLabelGapPx?: number },
): YearXTick[] {
  if (
    !Number.isFinite(tMin) ||
    !Number.isFinite(tMax) ||
    !Number.isFinite(padLeft) ||
    !Number.isFinite(innerW) ||
    tMax < tMin
  ) {
    return [];
  }
  if (innerW <= 0) return [];
  const tSpan = tMax - tMin;

  const fallbackTick = (year: number, t: number, x: number): YearXTick => ({
    year,
    label: String(year),
    x,
    t,
  });

  // Single instant or no year-end inside range → still show at least one year label.
  if (tSpan === 0) {
    const year = calendarYearAt(tMin);
    return [fallbackTick(year, tMin, padLeft + innerW / 2)];
  }

  const yLo = calendarYearAt(tMin);
  const yHi = calendarYearAt(tMax);
  const candidates: number[] = [];
  for (let y = yLo; y <= yHi + 1; y++) {
    const t = yearEndMs(y);
    if (!Number.isFinite(t)) continue;
    if (t >= tMin && t <= tMax) candidates.push(y);
  }
  if (candidates.length === 0) {
    const year = calendarYearAt((tMin + tMax) / 2);
    return [fallbackTick(year, (tMin + tMax) / 2, padLeft + innerW / 2)];
  }

  const minGap = opts?.minLabelGapPx ?? 72;
  const preferred = Math.max(1, opts?.step ?? 2);
  const xOf = (y: number) =>
    padLeft + ((yearEndMs(y) - tMin) / tSpan) * innerW;

  const pick = (step: number): YearXTick[] => {
    const first = candidates[0]!;
    const years = candidates.filter((y) => (y - first) % step === 0);
    return years.map((year) => ({
      year,
      label: String(year),
      x: xOf(year),
      t: yearEndMs(year),
    }));
  };

  let step = preferred;
  let ticks = pick(step);
  while (ticks.length > 2 && step < 20) {
    let ok = true;
    for (let i = 1; i < ticks.length; i++) {
      if (ticks[i]!.x - ticks[i - 1]!.x < minGap) {
        ok = false;
        break;
      }
    }
    if (ok) break;
    step += 1;
    ticks = pick(step);
  }
  return ticks;
}

export function StackedTrendChart({
  data,
  sampleMode = false,
  initialRange,
}: {
  data: CpfTrendData | null;
  sampleMode?: boolean;
  initialRange?: ChartRangeMode;
}) {
  const baseId = useId();
  const [range, setRange] = useState<ChartRangeMode>(
    initialRange ?? data?.defaultRange ?? "12m",
  );
  const [hover, setHover] = useState<string | null>(null);

  if (!data || (data.points12.length === 0 && data.pointsAll.length === 0)) {
    return (
      <section id="c2-trend">
        <div className={"k-sec"}>
          <h2>
            余额走势
            {sampleMode ? (
              <span className={"chip chipSample"}>示例数据</span>
            ) : null}
            <span className={"chip chipEst"}>估算</span>
          </h2>
        </div>
        <EmptyBlock message="暂无走势数据" />
      </section>
    );
  }

  const points = range === "12m" ? data.points12 : data.pointsAll;
  const hovered = points.find((p) => p.t === hover) ?? null;

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setRange(e.key === "ArrowLeft" ? "12m" : "all");
  };

  return (
    <section id="c2-trend">
      <div className={"k-sec"}>
        <h2>
          余额走势
          {sampleMode ? (
            <span className={"chip chipSample"}>示例数据</span>
          ) : null}
          <span className={"chip chipEst"}>估算</span>
        </h2>
        <div className={"k-tools"}>
          <div
            className={"k-seg"}
            role="tablist"
            aria-label="走势图时间范围"
            onKeyDown={onTabKey}
          >
            <button
              type="button"
              role="tab"
              aria-selected={range === "12m"}
              className={range === "12m" ? "opt on" : "opt"}
              onClick={() => setRange("12m")}
            >
              近 12 个月
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={range === "all"}
              className={range === "all" ? "opt on" : "opt"}
              onClick={() => setRange("all")}
            >
              全部（2016 年起）
            </button>
          </div>
          <span className={"r"}>实线为实际，虚线为估算</span>
        </div>
      </div>

      <div className={"card"}>
        <div className={"k-ph"}>
          {range === "12m" ? "近 12 个月 · 实际" : "全部 · 实际 + 估算"}
          <span className={"k-yr"}>
            {range === "12m"
              ? data.subtitle12 ?? "月底数为主；虚线为推算"
              : data.subtitleAll ?? "年底数 / 月底数 · 虚线为推算"}
          </span>
        </div>

        <TrendSvg
          points={points}
          mode={range}
          baseId={baseId}
          data={data}
          onHover={setHover}
        />

        <p className={"qj-dashChartTooltip"} aria-live="polite">
          {hovered
            ? tipText(hovered)
            : "悬停或聚焦数据点可查看明细（年底数 / 月底数）；左右方向键切换范围"}
        </p>

        <div className={"legend"}>
          <span>
            <span className={"k-sw k-sw-oa"} aria-hidden="true" />
            OA
          </span>
          <span>
            <span className={"k-sw k-sw-sa"} aria-hidden="true" />
            SA
          </span>
          <span>
            <span className={"k-sw k-sw-ma"} aria-hidden="true" />
            MA
          </span>
          <span>
            <i className={"leg-solid"} aria-hidden="true" />
            实际（含 1 月利息台阶）
          </span>
          <span>
            <i className={"leg-dash"} aria-hidden="true" />
            估算（按月复利）
          </span>
          {range === "all" ? (
            <>
              <span>
                <i className={"leg-year"} aria-hidden="true" />
                年底数
              </span>
              <span>
                <i className={"leg-month"} aria-hidden="true" />
                月底数
              </span>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function tipText(p: CpfTrendPoint): string {
  const grain = p.grain === "year" ? "年底数" : "月底数";
  const phase = p.phase === "projected" ? "（推算）" : "";
  const tot = p.balances.OA + p.balances.SA + p.balances.MA;
  return `${p.t} ${grain}${phase}：OA ${formatMoney(p.balances.OA)} · SA ${formatMoney(p.balances.SA)} · MA ${formatMoney(p.balances.MA)} · 合计 ${formatMoney(tot)}`;
}

function TrendSvg({
  points,
  mode,
  baseId,
  data,
  onHover,
}: {
  points: CpfTrendPoint[];
  mode: ChartRangeMode;
  baseId: string;
  data: CpfTrendData;
  onHover: (t: string | null) => void;
}) {
  const W = mode === "all" ? 900 : 640;
  const H = 320;
  const PAD = { top: 24, right: 16, bottom: 36, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  // Draw in time order (year before month on ties) so paths never go backwards.
  const ordered = sortTrendPointsByTime(points);

  const totals = ordered.map(
    (p) => p.balances.OA + p.balances.SA + p.balances.MA,
  );
  const guideMax = data.guides.reduce((m, g) => Math.max(m, g.amount), 0);
  const maxV =
    (ordered.length === 0
      ? Math.max(guideMax * 0.3, 1)
      : Math.max(...totals, guideMax * 0.3, 1)) * 1.08;
  const pointTimes = ordered.map((p) => parseTrendPointTime(p.t));
  const xAt = xPositionsForDates(pointTimes, PAD.left, innerW);
  const validTimes = pointTimes.filter(
    (t): t is number => t != null && Number.isFinite(t),
  );
  const tMin = validTimes.length ? Math.min(...validTimes) : NaN;
  const tMax = validTimes.length ? Math.max(...validTimes) : NaN;

  const xy = (i: number, v: number) => ({
    x: xAt[i] ?? PAD.left,
    y: PAD.top + (1 - v / maxV) * innerH,
  });

  const stackLayers = (
    phase: "actual" | "projected",
    key: keyof AccBalances,
    baseline: (p: CpfTrendPoint) => number,
  ) => {
    const idxs = ordered
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.phase === phase);
    if (idxs.length === 0) return "";
    let seq = idxs;
    if (phase === "projected") {
      const lastActual = [...ordered.entries()]
        .reverse()
        .find(([, p]) => p.phase === "actual");
      if (lastActual) {
        seq = [{ p: lastActual[1], i: lastActual[0] }, ...idxs];
      }
    }
    const top = seq.map(({ p, i }) => {
      const v = baseline(p) + p.balances[key];
      return xy(i, v);
    });
    const bot = [...seq]
      .reverse()
      .map(({ p, i }) => xy(i, baseline(p)));
    return [...top, ...bot]
      .map((pt, j) => `${j === 0 ? "M" : "L"}${pt.x},${pt.y}`)
      .join(" ");
  };

  const topLine = (phase: "actual" | "projected") => {
    let seq = ordered
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.phase === phase);
    if (phase === "projected") {
      const lastActual = [...ordered.entries()]
        .reverse()
        .find(([, p]) => p.phase === "actual");
      if (lastActual) seq = [{ p: lastActual[1], i: lastActual[0] }, ...seq];
    }
    return seq
      .map(({ p, i }, j) => {
        const tot = p.balances.OA + p.balances.SA + p.balances.MA;
        const { x, y } = xy(i, tot);
        return `${j === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ");
  };

  const gridVals =
    mode === "all"
      ? [100_000, 200_000, 300_000, 400_000]
      : [100_000, 200_000, 300_000];

  const xLabels: Array<{ label: string; x: number }> =
    mode === "12m"
      ? buildTwelveMonthXLabels(ordered).map((xl) => ({
          label: xl.label,
          x: xAt[xl.i] ?? PAD.left,
        }))
      : buildYearXTicks(tMin, tMax, PAD.left, innerW);

  const janIdx = data.janInterestAt
    ? ordered.findIndex((p) => p.t === data.janInterestAt)
    : -1;

  const employer = data.events.filter((e) => e.kind === "employer_change");
  const transfers = data.events.filter((e) => e.kind === "lump_sum");

  return (
    <svg
      className={"qj-dashChartSvg k-trendSvg"}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-labelledby={`${baseId}-sum`}
    >
      <title id={`${baseId}-sum`}>
        {`三户口堆叠走势，共 ${ordered.length} 个点`}
      </title>

      {gridVals.map((v) => {
        const y = xy(0, v).y;
        if (y < PAD.top || y > PAD.top + innerH) return null;
        return (
          <g key={v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              className={"qj-dashChartGrid"}
            />
            <text
              x={PAD.left - 6}
              y={y + 4}
              textAnchor="end"
              className={"k-axisText"}
            >
              {`${v / 10000}万`}
            </text>
          </g>
        );
      })}

      <path
        d={stackLayers("actual", "OA", () => 0)}
        fill={CPF_COLORS.oa}
        opacity={0.95}
      />
      <path
        d={stackLayers("actual", "SA", (p) => p.balances.OA)}
        fill={CPF_COLORS.sa}
        opacity={0.92}
      />
      <path
        d={stackLayers("actual", "MA", (p) => p.balances.OA + p.balances.SA)}
        fill={CPF_COLORS.ma}
        opacity={0.9}
      />
      <path
        d={stackLayers("projected", "OA", () => 0)}
        fill={CPF_COLORS.oa}
        opacity={0.35}
      />
      <path
        d={stackLayers("projected", "SA", (p) => p.balances.OA)}
        fill={CPF_COLORS.sa}
        opacity={0.3}
      />
      <path
        d={stackLayers(
          "projected",
          "MA",
          (p) => p.balances.OA + p.balances.SA,
        )}
        fill={CPF_COLORS.ma}
        opacity={0.28}
      />

      <path d={topLine("actual")} className={"k-topActual"} fill="none" />
      <path d={topLine("projected")} className={"k-topProjected"} fill="none" />

      {janIdx >= 0 && data.janInterestTotal != null ? (
        <text
          x={xy(janIdx, totals[janIdx] ?? 0).x}
          y={xy(janIdx, totals[janIdx] ?? 0).y - 10}
          textAnchor="middle"
          className={"k-stepLabel"}
        >
          {`1 月利息 +${formatMoney(data.janInterestTotal)}`}
        </text>
      ) : null}

      {mode === "all"
        ? data.guides.map((g) => (
            <g key={g.key}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={xy(0, g.amount).y}
                y2={xy(0, g.amount).y}
                className={"k-guideLine"}
              />
              <text
                x={W - PAD.right}
                y={xy(0, g.amount).y - 4}
                textAnchor="end"
                className={"k-guideLabel"}
              >
                {g.label}
              </text>
            </g>
          ))
        : null}

      {ordered.map((p, i) => {
        if (p.phase === "projected") return null;
        const tot = p.balances.OA + p.balances.SA + p.balances.MA;
        const { x, y } = xy(i, tot);
        const r = p.grain === "year" ? 4.5 : 2.2;
        return (
          <g key={`${p.t}-${i}`}>
            <circle
              cx={x}
              cy={y}
              r={r}
              className={p.grain === "year" ? "k-dotYear" : "k-dotMonth"}
            />
            <circle
              cx={x}
              cy={y}
              r={10}
              className={"qj-dashChartHit"}
              tabIndex={0}
              role="button"
              aria-label={tipText(p)}
              onFocus={() => onHover(p.t)}
              onBlur={() => onHover(null)}
              onMouseEnter={() => onHover(p.t)}
              onMouseLeave={() => onHover(null)}
            />
          </g>
        );
      })}

      {employer.map((ev) => {
        const i = nearestIndex(ordered, ev.t);
        if (i < 0) return null;
        const { x } = xy(i, 0);
        return (
          <g key={`emp-${ev.t}`}>
            <rect
              x={x - 22}
              y={H - 28}
              width={44}
              height={16}
              rx={4}
              className={"k-empBadge"}
            />
            <text x={x} y={H - 16} textAnchor="middle" className={"k-empText"}>
              换雇主
            </text>
          </g>
        );
      })}
      {transfers.map((tr) => {
        const i = nearestIndex(ordered, tr.t);
        if (i < 0) return null;
        const tot =
          ordered[i]!.balances.OA +
          ordered[i]!.balances.SA +
          ordered[i]!.balances.MA;
        const { x, y } = xy(i, tot);
        return (
          <g key={`flag-${tr.t}-${tr.short ?? tr.label}`}>
            <line
              x1={x}
              x2={x}
              y1={y - 8}
              y2={y - 28}
              className={"qj-dashChartFlagPole"}
            />
            <path
              d={`M${x} ${y - 28} l12 5 l-12 5 z`}
              className={"qj-dashChartFlag"}
            />
            <title>{tr.label}</title>
            <text x={x + 14} y={y - 22} className={"k-flagLabel"}>
              {tr.short ?? tr.label}
            </text>
          </g>
        );
      })}

      {xLabels.map((xl) => (
        <text
          key={xl.label}
          x={xl.x}
          y={H - 8}
          textAnchor="middle"
          className={"k-axisText"}
        >
          {xl.label}
        </text>
      ))}
    </svg>
  );
}

function nearestIndex(points: CpfTrendPoint[], t: string): number {
  let i = points.findIndex((p) => p.t === t || p.t.startsWith(t));
  if (i >= 0) return i;
  if (/^\d{4}$/.test(t)) {
    i = points.findIndex((p) => p.t === t || p.t.startsWith(`${t}-`));
    return i;
  }
  const y = t.slice(0, 4);
  return points.findIndex((p) => p.t === y);
}
