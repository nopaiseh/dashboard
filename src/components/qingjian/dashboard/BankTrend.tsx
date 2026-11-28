"use client";

import { useMemo, useState } from "react";
import type { BankAccountKey } from "@/lib/bank-block-keys";
import { BANK_EMPTY, formatBankMoney } from "./bankFormat";
import type { BankTrendPoint, BankTrendSeries, BankViewModel } from "./bankModel";
import {
  BANK_ACCOUNT_COLORS,
  BANK_ACTUAL_STROKE,
  BANK_PROJ_STROKE,
} from "./bankTheme";
import { EmptyBlock } from "./EmptyBlock";
import type { ChartRangeMode } from "./types";

/** 趋势页：账户筛选 + 近12月/全部 + 实际实线 / 预测虚线。 */
export function BankTrend({
  model,
  sampleMode = false,
}: {
  model: BankViewModel;
  sampleMode?: boolean;
}) {
  const trends = model.trends;
  const [filter, setFilter] = useState<BankAccountKey | "all">("all");
  const defaultRange: ChartRangeMode =
    trends.find((t) => t.defaultRange)?.defaultRange ?? "12m";
  const [range, setRange] = useState<ChartRangeMode>(defaultRange);

  const visible = useMemo(() => {
    if (filter === "all") return trends;
    return trends.filter((t) => t.accountKey === filter);
  }, [trends, filter]);

  if (trends.length === 0) {
    return (
      <div className={"k-bankPanel"}>
        <div className={"k-sec"}>
          <h2>
            趋势
            {sampleMode ? (
              <span className={"chip chipSample"}>示意数据</span>
            ) : null}
          </h2>
        </div>
        <EmptyBlock message="暂无趋势" />
      </div>
    );
  }

  return (
    <div className={"k-bankPanel"}>
      <div className={"k-bankChips"} role="group" aria-label="按户口筛选">
        <button
          type="button"
          className={filter === "all" ? "opt on" : "opt"}
          onClick={() => setFilter("all")}
        >
          全部户口
        </button>
        {trends.map((t) => (
          <button
            key={t.accountKey}
            type="button"
            className={filter === t.accountKey ? "opt on" : "opt"}
            onClick={() => setFilter(t.accountKey)}
          >
            {t.title}
          </button>
        ))}
      </div>

      <div className={"k-sec"}>
        <h2>
          趋势
          {sampleMode ? (
            <span className={"chip chipSample"}>示意数据</span>
          ) : null}
        </h2>
        <div className={"k-tools"}>
          <span className={"r"}>点为月末余额 · x 轴按点数等距</span>
          <div className={"k-seg"} role="group" aria-label="时间范围">
            <button
              type="button"
              className={range === "12m" ? "opt on" : "opt"}
              onClick={() => setRange("12m")}
            >
              近 12 个月
            </button>
            <button
              type="button"
              className={range === "all" ? "opt on" : "opt"}
              onClick={() => setRange("all")}
            >
              全部
            </button>
          </div>
        </div>
      </div>

      <div className={"k-bankTrendGrid"}>
        {visible.map((series) => (
          <TrendCard
            key={series.accountKey}
            series={series}
            range={range}
          />
        ))}
      </div>
    </div>
  );
}

function TrendCard({
  series,
  range,
}: {
  series: BankTrendSeries;
  range: ChartRangeMode;
}) {
  const points = filterByRange(series.points, range);
  const hasData = points.length > 0;

  return (
    <div className={"card"}>
      <div
        className={"hd"}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "0.4rem",
        }}
      >
        <h3 style={{ margin: 0, fontSize: "0.95rem" }}>
          <span
            className={"k-bankSw"}
            style={{ background: BANK_ACCOUNT_COLORS[series.accountKey] }}
            aria-hidden="true"
          />
          {series.title}
        </h3>
        <span className={"mut"} style={{ fontSize: "0.72rem" }}>
          月末余额 · S$
        </span>
      </div>
      {!hasData ? (
        <div className={"k-bankEmptybox"}>{BANK_EMPTY}</div>
      ) : (
        <div className={"k-bankChart"}>
          <TrendSvg points={points} title={series.title} />
          <div className={"legend"}>
            <span>
              <i />
              实际
            </span>
            <span>
              <i className={"d"} />
              目标路径（预测）
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function filterByRange(
  points: BankTrendPoint[],
  range: ChartRangeMode,
): BankTrendPoint[] {
  if (range === "all" || points.length === 0) return points;
  // 近 12 个不同月份（按时间序取尾部）
  const months = [...new Set(points.map((p) => p.t))].sort();
  const keep = new Set(months.slice(-12));
  return points.filter((p) => keep.has(p.t));
}

function TrendSvg({
  points,
  title,
}: {
  points: BankTrendPoint[];
  title: string;
}) {
  const W = 520;
  const H = 190;
  const padL = 46;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const months = [...new Set(points.map((p) => p.t))].sort();
  const values = points.map((p) => p.v);
  const { yMin, yMax } = computeTrendYDomain(values);
  const ySpan = yMax - yMin || 1;

  const xAt = (i: number) =>
    months.length <= 1
      ? padL + innerW / 2
      : padL + (i / (months.length - 1)) * innerW;
  const yAt = (v: number) => padT + innerH * (1 - (v - yMin) / ySpan);

  const actual = points.filter((p) => p.phase === "actual");
  const projected = points.filter((p) => p.phase === "projected");

  // 预测线从最后一个实际点接上（设计稿虚线）
  const bridge: BankTrendPoint[] = [];
  if (actual.length > 0 && projected.length > 0) {
    bridge.push(actual[actual.length - 1]!);
  }
  const projLine = [...bridge, ...projected];

  const poly = (pts: BankTrendPoint[]) =>
    pts
      .map((p) => {
        const ix = months.indexOf(p.t);
        return `${xAt(ix)},${yAt(p.v)}`;
      })
      .join(" ");

  const gridN = 4;
  const grid = Array.from({ length: gridN + 1 }, (_, i) => {
    const v = yMin + (ySpan / gridN) * i;
    return { v, y: yAt(v) };
  });

  const lastActual = actual[actual.length - 1];
  const xLabels = pickXLabels(months);
  const showZero = yMin < 0 && yMax > 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}趋势`}>
      {grid.map((g) => (
        <g key={`g-${g.v}`}>
          <line
            className={"gl"}
            x1={padL}
            x2={W - padR}
            y1={g.y}
            y2={g.y}
          />
          <text className={"ax"} x={padL - 6} y={g.y + 3.5} textAnchor="end">
            {formatAxis(g.v)}
          </text>
        </g>
      ))}
      {showZero ? (
        <line
          className={"gl"}
          x1={padL}
          x2={W - padR}
          y1={yAt(0)}
          y2={yAt(0)}
          stroke="#94a3b8"
          strokeWidth={1.25}
          data-zero-line="1"
        />
      ) : null}
      {xLabels.map((lab) => (
        <text
          key={lab.t}
          className={"ax"}
          x={xAt(lab.i)}
          y={H - 8}
          textAnchor={lab.anchor}
        >
          {lab.t}
        </text>
      ))}
      {projLine.length > 1 ? (
        <polyline
          points={poly(projLine)}
          fill="none"
          stroke={BANK_PROJ_STROKE}
          strokeWidth={2}
          strokeDasharray="5 4"
        />
      ) : null}
      {actual.length > 1 ? (
        <polyline
          points={poly(actual)}
          fill="none"
          stroke={BANK_ACTUAL_STROKE}
          strokeWidth={2.5}
        />
      ) : null}
      {lastActual ? (
        <>
          <circle
            cx={xAt(months.indexOf(lastActual.t))}
            cy={yAt(lastActual.v)}
            r={3.5}
            fill={BANK_ACTUAL_STROKE}
          />
          <text
            className={"ax"}
            style={{ fill: "#1b4332", fontWeight: 700 }}
            x={xAt(months.indexOf(lastActual.t))}
            y={yAt(lastActual.v) - 8}
            textAnchor="middle"
          >
            {formatTrendValueLabel(lastActual.v)}
          </text>
        </>
      ) : null}
    </svg>
  );
}

/** 趋势点标签：去掉「S$」保留负号（−1234 而非 1,234）。 */
export function formatTrendValueLabel(v: number): string {
  return formatBankMoney(v, v % 1 === 0 ? 0 : 2).replace("S$", "");
}

/** Y 轴按数据最小/最大值定范围（含负余额），不强制从 0 起。 */
export function computeTrendYDomain(values: number[]): {
  yMin: number;
  yMax: number;
} {
  if (values.length === 0) return { yMin: 0, yMax: 1 };
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  let yMin = niceFloor(rawMin);
  let yMax = niceCeil(rawMax);
  if (yMin === yMax) {
    yMin = niceFloor(rawMin - 1);
    yMax = niceCeil(rawMax + 1);
  }
  if (yMin >= yMax) {
    yMax = yMin + 1;
  }
  return { yMin, yMax };
}

function niceCeil(n: number): number {
  if (n === 0) return 0;
  if (n < 0) return -niceFloor(-n);
  const pow = 10 ** Math.floor(Math.log10(n));
  const m = n / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * pow;
}

function niceFloor(n: number): number {
  if (n === 0) return 0;
  if (n < 0) return -niceCeil(-n);
  const pow = 10 ** Math.floor(Math.log10(n));
  const m = n / pow;
  const nice =
    m >= 5 ? 5 : m >= 2.5 ? 2.5 : m >= 2 ? 2 : m >= 1 ? 1 : m;
  return nice * pow;
}

function formatAxis(v: number): string {
  const rounded = Math.round(v);
  const sign = rounded < 0 ? "−" : "";
  const abs = Math.abs(rounded);
  if (abs >= 1000) {
    return `${sign}${abs.toLocaleString("en-SG", { maximumFractionDigits: 0 })}`;
  }
  return `${sign}${abs}`;
}

function pickXLabels(
  months: string[],
): Array<{ t: string; i: number; anchor: "start" | "middle" | "end" }> {
  if (months.length === 0) return [];
  if (months.length === 1) {
    return [{ t: months[0]!, i: 0, anchor: "middle" }];
  }
  const mid = Math.floor((months.length - 1) / 2);
  return [
    { t: months[0]!, i: 0, anchor: "start" },
    { t: months[mid]!, i: mid, anchor: "middle" },
    { t: months[months.length - 1]!, i: months.length - 1, anchor: "end" },
  ];
}
