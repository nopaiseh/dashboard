"use client";

import { useId, useMemo, useState } from "react";
import { EmptyBlock } from "./EmptyBlock";
import {
  buildPolyline,
  filterEventsByRange,
  filterSeriesByRange,
} from "./chartRange";
import { formatMoney, parsePointTime, pointTimeLabel } from "./format";
import { PROJECTION_NOTE } from "./labels";
import type { ChartRangeMode, ChartSeriesView, ChartViewPoint } from "./types";

const W = 640;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 48 };

export function ChartSeriesBlock({ view }: { view: ChartSeriesView }) {
  const baseId = useId();
  const [range, setRange] = useState<ChartRangeMode>(view.defaultRange);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const filtered = useMemo(
    () => filterSeriesByRange(view.series, range, view.allFromYear),
    [view.series, view.allFromYear, range],
  );
  const events = useMemo(
    () => filterEventsByRange(view.events, range, view.allFromYear),
    [view.events, view.allFromYear, range],
  );

  if (view.emptyText || filtered.length === 0) {
    return (
      <EmptyBlock title={view.title} message={view.emptyText ?? "暂无数据"} />
    );
  }

  const layout = layoutChart(filtered);
  const actualPts = layout.points.filter((p) => p.phase === "actual");
  const projectedPts = layout.points.filter((p) => p.phase === "projected");

  // Bridge: last actual → first projected for continuous dashed start
  const projectedPathPts =
    actualPts.length > 0 && projectedPts.length > 0
      ? [actualPts[actualPts.length - 1], ...projectedPts]
      : projectedPts;

  const active = activeIdx != null ? layout.points[activeIdx] : null;
  const unit = view.unit ?? "S$";

  return (
    <article className={"qj-dashBlock qj-dashChart"}>
      <div className={"qj-dashChartHead"}>
        {view.title ? (
          <h3 className={"qj-dashBlockTitle"}>{view.title}</h3>
        ) : (
          <h3 className={"qj-dashBlockTitle"}>走势</h3>
        )}
        <div
          className={"qj-dashChartTabs"}
          role="tablist"
          aria-label="走势时间范围"
        >
          <RangeTab
            id={`${baseId}-12m`}
            selected={range === "12m"}
            onSelect={() => setRange("12m")}
            label="近 12 个月"
          />
          <RangeTab
            id={`${baseId}-all`}
            selected={range === "all"}
            onSelect={() => setRange("all")}
            label={`全部（${view.allFromYear} 年起）`}
          />
        </div>
      </div>

      <div className={"qj-dashChartCanvas"}>
        <svg
          className={"qj-dashChartSvg"}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${baseId}-summary`}
        >
          <title id={`${baseId}-summary`}>
            {`${view.title ?? "走势图"}，共 ${filtered.length} 个数据点`}
          </title>
          {layout.gridYs.map((y, i) => (
            <line
              key={`g-${i}`}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y}
              y2={y}
              className={"qj-dashChartGrid"}
            />
          ))}
          <path
            d={buildPolyline(actualPts)}
            className={"qj-dashChartLineActual"}
            fill="none"
          />
          {projectedPathPts.length > 1 ? (
            <path
              d={buildPolyline(projectedPathPts)}
              className={"qj-dashChartLineProjected"}
              fill="none"
            />
          ) : null}
          {layout.points.map((pt, i) => (
            <g key={`${pt.t}-${i}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={pt.grain === "year" ? 4.5 : 2.5}
                className={
                  pt.phase === "projected"
                    ? "qj-dashChartDotProjected"
                    : pt.grain === "year"
                      ? "qj-dashChartDotYear"
                      : "qj-dashChartDotMonth"
                }
              />
              <circle
                cx={pt.x}
                cy={pt.y}
                r="10"
                className={"qj-dashChartHit"}
                tabIndex={0}
                role="button"
                aria-label={`${pointTimeLabel(pt.t, pt.grain)} ${formatMoney(pt.v, unit)}${pt.phase === "projected" ? "（推算）" : ""}`}
                onFocus={() => setActiveIdx(i)}
                onBlur={() => setActiveIdx((cur) => (cur === i ? null : cur))}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() =>
                  setActiveIdx((cur) => (cur === i ? null : cur))
                }
              />
            </g>
          ))}
          {events.map((ev) => {
            const anchor = nearestPoint(layout.points, ev.t);
            if (!anchor) return null;
            const isFlag = ev.kind === "lump_sum";
            return (
              <g
                key={`${ev.kind}-${ev.t}`}
                className={"qj-dashChartEvent"}
                aria-label={ev.label}
              >
                {isFlag ? (
                  <>
                    <line
                      x1={anchor.x}
                      x2={anchor.x}
                      y1={anchor.y - 18}
                      y2={anchor.y - 4}
                      className={"qj-dashChartFlagPole"}
                    />
                    <path
                      d={`M${anchor.x} ${anchor.y - 18} l10 4 l-10 4 z`}
                      className={"qj-dashChartFlag"}
                    />
                    <title>{ev.label}</title>
                  </>
                ) : (
                  <>
                    <circle
                      cx={anchor.x}
                      cy={anchor.y - 14}
                      r="3.5"
                      className={"qj-dashChartEmployer"}
                    />
                    <title>{ev.label}</title>
                  </>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <p className={"qj-dashChartTooltip"} aria-live="polite">
        {active
          ? `${pointTimeLabel(active.t, active.grain)}：${formatMoney(active.v, unit)}${active.phase === "projected" ? "（推算）" : ""}`
          : "悬停或聚焦数据点可查看明细"}
      </p>

      {view.projectionNote ? (
        <p className={"qj-dashProjectionNote"}>{PROJECTION_NOTE}</p>
      ) : null}

      <p className={"qj-sr-only"}>
        实线为历史数据，虚线为推算；年度点较大，月度点较小。
      </p>
    </article>
  );
}

function RangeTab({
  id,
  selected,
  onSelect,
  label,
}: {
  id: string;
  selected: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={
        selected ? "qj-dashChartTab qj-dashChartTabOn" : "qj-dashChartTab"
      }
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {label}
    </button>
  );
}

type LaidOut = ChartViewPoint & { x: number; y: number };

function layoutChart(series: ChartViewPoint[]): {
  points: LaidOut[];
  gridYs: number[];
} {
  const times = series.map((p) => parsePointTime(p.t) ?? 0);
  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const minV = Math.min(...series.map((p) => p.v));
  const maxV = Math.max(...series.map((p) => p.v));
  const spanT = Math.max(1, maxT - minT);
  const spanV = Math.max(1, maxV - minV);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const points = series.map((p, i) => {
    const t = times[i] ?? minT;
    const x = PAD.left + ((t - minT) / spanT) * innerW;
    const y = PAD.top + (1 - (p.v - minV) / spanV) * innerH;
    return { ...p, x, y };
  });

  const gridYs = [0, 0.5, 1].map((f) => PAD.top + f * innerH);
  return { points, gridYs };
}

function nearestPoint(points: LaidOut[], t: string): LaidOut | null {
  const target = parsePointTime(t);
  if (target == null || points.length === 0) {
    return points.find((p) => p.t === t) ?? null;
  }
  let best = points[0];
  let bestDist = Math.abs((parsePointTime(best.t) ?? 0) - target);
  for (const p of points) {
    const d = Math.abs((parsePointTime(p.t) ?? 0) - target);
    if (d < bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best;
}
