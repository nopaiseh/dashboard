"use client";

import { useId, useMemo, useState } from "react";
import {
  C2_COLORS,
  C2_EMPLOYER_CHANGES,
  C2_HIT,
  C2_INT_TOTAL,
  C2_MONTHS,
  C2_PROJ,
  C2_TARGETS,
  C2_TRANSFERS,
  C2_YEAR_END,
  type AccBalances,
} from "./c2Data";
import { formatMoney } from "./format";
import type { ChartRangeMode } from "./types";

type StackPoint = {
  t: string;
  balances: AccBalances;
  phase: "actual" | "projected";
  grain: "month" | "year";
};

export function StackedTrendChart({
  sampleMode = false,
  initialRange = "12m",
}: {
  sampleMode?: boolean;
  /** 截图夹具可强制「全部」视图 */
  initialRange?: ChartRangeMode;
}) {
  const baseId = useId();
  const [range, setRange] = useState<ChartRangeMode>(initialRange);
  const [hover, setHover] = useState<string | null>(null);

  const points12 = useMemo(() => build12m(), []);
  const pointsAll = useMemo(() => buildAll(), []);
  const points = range === "12m" ? points12 : pointsAll;
  const hovered = points.find((p) => p.t === hover) ?? null;

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
          {range === "12m"
            ? "近 12 个月 · 实际"
            : "全部 · 实际 + 估算"}
          <span className={"k-yr"}>
            {range === "12m"
              ? "2025 年 11 月 – 2026 年 10 月，均为月底数"
              : "2016–2025 年底数 · 2026 起月底数 · 虚线为推算"}
          </span>
        </div>

        <TrendSvg
          points={points}
          mode={range}
          baseId={baseId}
          onHover={setHover}
        />

        <p className={"qj-dashChartTooltip"} aria-live="polite">
          {hovered
            ? tipText(hovered)
            : "悬停或聚焦数据点可查看明细（年底数 / 月底数）"}
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

function tipText(p: StackPoint): string {
  const grain = p.grain === "year" ? "年底数" : "月底数";
  const phase = p.phase === "projected" ? "（推算）" : "";
  const tot = p.balances.OA + p.balances.SA + p.balances.MA;
  return `${p.t} ${grain}${phase}：OA ${formatMoney(p.balances.OA)} · SA ${formatMoney(p.balances.SA)} · MA ${formatMoney(p.balances.MA)} · 合计 ${formatMoney(tot)}`;
}

function build12m(): StackPoint[] {
  const actual = C2_MONTHS.map((m) => ({
    t: m.t,
    balances: m.balances,
    phase: "actual" as const,
    grain: "month" as const,
  }));
  // 近 12 个月视图：再往后约半年推算（逐月）
  const projected = C2_PROJ.filter((m) => m.t <= "2027-04").map((m) => ({
    t: m.t,
    balances: m.balances,
    phase: "projected" as const,
    grain: "month" as const,
  }));
  return [...actual, ...projected];
}

function buildAll(): StackPoint[] {
  const years: StackPoint[] = Object.entries(C2_YEAR_END).map(
    ([y, balances]) => ({
      t: y,
      balances,
      phase: "actual" as const,
      grain: "year" as const,
    }),
  );
  const months2026 = C2_MONTHS.filter((m) => m.t.startsWith("2026")).map(
    (m) => ({
      t: m.t,
      balances: m.balances,
      phase: "actual" as const,
      grain: "month" as const,
    }),
  );
  const projected = C2_PROJ.map((m) => ({
    t: m.t,
    balances: m.balances,
    phase: "projected" as const,
    grain: "month" as const,
  }));
  return [...years, ...months2026, ...projected];
}

function TrendSvg({
  points,
  mode,
  baseId,
  onHover,
}: {
  points: StackPoint[];
  mode: ChartRangeMode;
  baseId: string;
  onHover: (t: string | null) => void;
}) {
  const W = mode === "all" ? 900 : 640;
  const H = 320;
  const PAD = { top: 24, right: 16, bottom: 36, left: 48 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const totals = points.map(
    (p) => p.balances.OA + p.balances.SA + p.balances.MA,
  );
  const maxV = Math.max(...totals, C2_TARGETS.ERS * 0.3) * 1.08;
  const n = Math.max(1, points.length - 1);

  const xy = (i: number, v: number) => ({
    x: PAD.left + (i / n) * innerW,
    y: PAD.top + (1 - v / maxV) * innerH,
  });

  const stackLayers = (
    phase: "actual" | "projected",
    key: keyof AccBalances,
    baseline: (p: StackPoint) => number,
  ) => {
    const idxs = points
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.phase === phase);
    if (idxs.length === 0) return "";
    // Include bridge from last actual for projected
    let seq = idxs;
    if (phase === "projected") {
      const lastActual = [...points.entries()]
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
    let seq = points
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.phase === phase);
    if (phase === "projected") {
      const lastActual = [...points.entries()]
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

  const gridVals = mode === "all"
    ? [100_000, 200_000, 300_000, 400_000]
    : [100_000, 200_000, 300_000];

  const xLabels =
    mode === "12m"
      ? [
          { i: 0, label: "11月" },
          { i: 2, label: "1月" },
          { i: 5, label: "4月" },
          { i: 8, label: "7月" },
          { i: 11, label: "10月" },
        ]
      : [
          { i: points.findIndex((p) => p.t === "2016"), label: "2016" },
          { i: points.findIndex((p) => p.t === "2018"), label: "2018" },
          { i: points.findIndex((p) => p.t === "2020"), label: "2020" },
          { i: points.findIndex((p) => p.t === "2022"), label: "2022" },
          { i: points.findIndex((p) => p.t === "2024"), label: "2024" },
          { i: points.findIndex((p) => p.t === "2026-01"), label: "2026" },
        ].filter((x) => x.i >= 0);

  // Jan interest step annotation (2026-01)
  const janIdx = points.findIndex((p) => p.t === "2026-01");
  const decIdx = points.findIndex((p) => p.t === "2025-12" || p.t === "2025");

  return (
    <svg
      className={"qj-dashChartSvg k-trendSvg"}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-labelledby={`${baseId}-sum`}
    >
      <title id={`${baseId}-sum`}>
        {`三户口堆叠走势，共 ${points.length} 个点`}
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

      {/* stacked fills: OA (bottom), SA, MA */}
      <path
        d={stackLayers("actual", "OA", () => 0)}
        fill={C2_COLORS.oa}
        opacity={0.95}
      />
      <path
        d={stackLayers("actual", "SA", (p) => p.balances.OA)}
        fill={C2_COLORS.sa}
        opacity={0.92}
      />
      <path
        d={stackLayers("actual", "MA", (p) => p.balances.OA + p.balances.SA)}
        fill={C2_COLORS.ma}
        opacity={0.9}
      />
      <path
        d={stackLayers("projected", "OA", () => 0)}
        fill={C2_COLORS.oa}
        opacity={0.35}
      />
      <path
        d={stackLayers("projected", "SA", (p) => p.balances.OA)}
        fill={C2_COLORS.sa}
        opacity={0.3}
      />
      <path
        d={stackLayers("projected", "MA", (p) => p.balances.OA + p.balances.SA)}
        fill={C2_COLORS.ma}
        opacity={0.28}
      />

      <path d={topLine("actual")} className={"k-topActual"} fill="none" />
      <path d={topLine("projected")} className={"k-topProjected"} fill="none" />

      {/* Jan interest step label */}
      {janIdx >= 0 && decIdx >= 0 ? (
        <g>
          <text
            x={xy(janIdx, totals[janIdx] ?? 0).x}
            y={xy(janIdx, totals[janIdx] ?? 0).y - 10}
            textAnchor="middle"
            className={"k-stepLabel"}
          >
            {`1 月利息 +${formatMoney(C2_INT_TOTAL)}`}
          </text>
        </g>
      ) : null}

      {/* FRS / BRS / ERS guides on all view */}
      {mode === "all" ? (
        <>
          <Guide
            y={xy(0, C2_TARGETS.FRS).y}
            label={`FRS 已达 · ${C2_HIT.FRS}`}
            x1={PAD.left}
            x2={W - PAD.right}
          />
          <Guide
            y={xy(0, C2_TARGETS.BRS).y}
            label={`BRS 已达 · ${C2_HIT.BRS}`}
            x1={PAD.left}
            x2={W - PAD.right}
          />
        </>
      ) : null}

      {/* points: year solid, month small; no hollow dots on projected */}
      {points.map((p, i) => {
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
              className={
                p.grain === "year" ? "k-dotYear" : "k-dotMonth"
              }
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

      {/* events: employer + transfers (all view; also 12m if in range) */}
      {C2_EMPLOYER_CHANGES.map((ev) => {
        const i = nearestIndex(points, ev.t);
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
            <text
              x={x}
              y={H - 16}
              textAnchor="middle"
              className={"k-empText"}
            >
              换雇主
            </text>
          </g>
        );
      })}
      {C2_TRANSFERS.map((tr) => {
        const i = nearestIndex(points, String(tr.year));
        if (i < 0) return null;
        const tot =
          points[i].balances.OA +
          points[i].balances.SA +
          points[i].balances.MA;
        const { x, y } = xy(i, tot);
        return (
          <g key={`flag-${tr.year}`}>
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
            <title>{tr.text}</title>
            <text
              x={x + 14}
              y={y - 22}
              className={"k-flagLabel"}
            >
              {tr.short}
            </text>
          </g>
        );
      })}

      {xLabels.map((xl) => {
        const { x } = xy(xl.i, 0);
        return (
          <text
            key={xl.label}
            x={x}
            y={H - 8}
            textAnchor="middle"
            className={"k-axisText"}
          >
            {xl.label}
          </text>
        );
      })}
    </svg>
  );
}

function Guide({
  y,
  label,
  x1,
  x2,
}: {
  y: number;
  label: string;
  x1: number;
  x2: number;
}) {
  return (
    <g>
      <line x1={x1} x2={x2} y1={y} y2={y} className={"k-guideLine"} />
      <text x={x2} y={y - 4} textAnchor="end" className={"k-guideLabel"}>
        {label}
      </text>
    </g>
  );
}

function nearestIndex(points: StackPoint[], t: string): number {
  // exact month
  let i = points.findIndex((p) => p.t === t || p.t.startsWith(t));
  if (i >= 0) return i;
  // year only
  if (/^\d{4}$/.test(t)) {
    i = points.findIndex((p) => p.t === t || p.t.startsWith(`${t}-`));
    return i;
  }
  // YYYY-MM → year end fallback
  const y = t.slice(0, 4);
  return points.findIndex((p) => p.t === y);
}
