import { EmptyBlock } from "./EmptyBlock";
import type { CpfProgressData } from "./cpfModel";
import { formatMoney, formatWan } from "./format";

export type TierStatusKind = "reached" | "reached_over" | "next" | "not_yet";

export type TierStatus = {
  kind: TierStatusKind;
  /** 已达，超出 S$ X 时的超出额；或下一档时间文案。 */
  detail?: string;
};

const TIER_ORDER = ["BRS", "FRS", "ERS"] as const;

/**
 * 进度比：分母为 0 / 非有限数时返回 0，避免 Infinity/NaN。
 */
export function ratioPct(numerator: number, denominator: number): number {
  if (
    !(denominator > 0) ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator)
  ) {
    return 0;
  }
  return (numerator / denominator) * 100;
}

/**
 * 由 reached_tier 优先，否则按金额 vs 目标推导 BRS/FRS/ERS 状态。
 * 文案：已达 / 已达，超出 S$ X / 下一档，约 YYYY 年 M 月 / 未到
 */
export function resolveRetirementStatuses(data: {
  oaSa: number;
  brs: number;
  frs: number;
  ers: number;
  exceedFrs: number;
  reachedTier?: string;
  nextEstimate?: string;
}): { BRS: TierStatus; FRS: TierStatus; ERS: TierStatus } {
  const targets = { BRS: data.brs, FRS: data.frs, ERS: data.ers };
  const reached = data.reachedTier?.trim().toUpperCase() || undefined;
  const reachedIdx = reached
    ? TIER_ORDER.indexOf(reached as (typeof TIER_ORDER)[number])
    : -1;

  const met = (key: (typeof TIER_ORDER)[number], idx: number) => {
    if (reachedIdx >= 0 && reachedIdx >= idx) return true;
    return data.oaSa >= targets[key];
  };

  let firstUnreached = -1;
  for (let i = 0; i < TIER_ORDER.length; i++) {
    if (!met(TIER_ORDER[i], i)) {
      firstUnreached = i;
      break;
    }
  }

  const statusFor = (
    key: (typeof TIER_ORDER)[number],
    idx: number,
  ): TierStatus => {
    if (met(key, idx)) {
      if (key === "FRS") {
        const over =
          data.exceedFrs > 0
            ? data.exceedFrs
            : Math.max(0, data.oaSa - data.frs);
        if (over > 0) return { kind: "reached_over", detail: formatMoney(over) };
      }
      return { kind: "reached" };
    }
    if (firstUnreached === idx && data.nextEstimate) {
      return { kind: "next", detail: data.nextEstimate };
    }
    return { kind: "not_yet" };
  };

  return {
    BRS: statusFor("BRS", 0),
    FRS: statusFor("FRS", 1),
    ERS: statusFor("ERS", 2),
  };
}

function statusTag(status: TierStatus) {
  switch (status.kind) {
    case "reached":
      return <span className={"chip chipOver"}>已达</span>;
    case "reached_over":
      return (
        <span className={"chip chipOver"}>
          已达，超出 {status.detail}
        </span>
      );
    case "next":
      return (
        <span className={"chip chipNext"}>
          下一档，约 {status.detail}
        </span>
      );
    case "not_yet":
      return <span className={"chip chipNeutral"}>未到</span>;
  }
}

export function CpfProgress({
  data,
  sampleMode = false,
}: {
  data: CpfProgressData | null;
  sampleMode?: boolean;
}) {
  if (!data) {
    return (
      <>
        <div className={"k-sec"}>
          <h2>
            目标进度
            {sampleMode ? (
              <span className={"chip chipSample"}>示例数据</span>
            ) : null}
            <span className={"chip chipEst"}>估算</span>
          </h2>
        </div>
        <EmptyBlock message="暂无目标进度" />
      </>
    );
  }

  const {
    ma,
    bhs,
    oaSa,
    brs: BRS,
    frs: FRS,
    ers: ERS,
    exceedFrs,
    reachedTier,
    nextEstimate,
    hitBhs,
  } = data;
  const maPct = Math.min(100, ratioPct(ma, bhs));
  const brsX = ratioPct(BRS, ERS);
  const frsX = ratioPct(FRS, ERS);
  const nowX = Math.min(100, ratioPct(oaSa, ERS));
  const brsPct = Math.round(ratioPct(oaSa, BRS));
  const frsPct = Math.round(ratioPct(oaSa, FRS));
  const solidToFrs = frsX;
  const overshootW = Math.max(0, nowX - frsX);
  const statuses = resolveRetirementStatuses({
    oaSa,
    brs: BRS,
    frs: FRS,
    ers: ERS,
    exceedFrs,
    reachedTier,
    nextEstimate,
  });

  return (
    <>
      <div className={"k-sec"}>
        <h2>
          目标进度
          {sampleMode ? (
            <span className={"chip chipSample"}>示例数据</span>
          ) : null}
          <span className={"chip chipEst"}>估算</span>
        </h2>
        <span className={"r"}>年度目标，每年 1 月更新</span>
      </div>
      <div className={"card"}>
        <div className={"k-goal"}>
          <div className={"k-grow"}>
            <h3>
              MA 对 BHS
              <small>医疗储蓄上限</small>
            </h3>
            <div
              className={"k-bw"}
              role="progressbar"
              aria-valuenow={Math.round(maPct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`MA 对 BHS 已达 ${Math.round(maPct)}%`}
            >
              <ProgressSvg
                marks={[
                  {
                    key: "BHS",
                    label: "BHS",
                    sub: formatWan(bhs),
                    x: 100,
                    end: true,
                  },
                ]}
                solid={maPct}
                overshoot={0}
                now={null}
              />
            </div>
            <div className={"k-ro"}>
              <div>
                <span>已达 BHS</span>
                <b>{Math.round(maPct)}%</b>
              </div>
              <div>
                <span>
                  {formatMoney(ma)} / {formatMoney(bhs)}
                </span>
                <b />
              </div>
              {hitBhs ? (
                <div>
                  <span>估算 达 BHS</span>
                  <b>约 {hitBhs}</b>
                </div>
              ) : null}
            </div>
          </div>

          <hr className={"k-hr"} />

          <div className={"k-grow"}>
            <h3>
              SA+OA 对 BRS / FRS / ERS
              <small>55 岁退休存款三档</small>
              <small>现有 {formatMoney(oaSa)}</small>
            </h3>
            <div
              className={"k-bw"}
              role="progressbar"
              aria-valuenow={Math.round(nowX)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`SA 加 OA 已达 FRS 的 ${frsPct}%，下一档 ERS 已达 ${Math.round(nowX)}%`}
            >
              <ProgressSvg
                marks={[
                  { key: "BRS", label: "BRS", sub: formatWan(BRS), x: brsX },
                  { key: "FRS", label: "FRS", sub: formatWan(FRS), x: frsX },
                  {
                    key: "ERS",
                    label: "ERS",
                    sub: formatWan(ERS),
                    x: 100,
                    end: true,
                  },
                ]}
                solid={solidToFrs}
                overshoot={overshootW}
                ticks={[brsX, frsX]}
                now={{ x: nowX, label: "现在 → 下一档" }}
              />
            </div>
            <div className={"k-ro"}>
              <div>
                <span>
                  BRS {formatMoney(BRS)}（{brsPct}%）
                </span>
                <b>{statusTag(statuses.BRS)}</b>
              </div>
              <div>
                <span>
                  FRS {formatMoney(FRS)}（{frsPct}%）
                </span>
                <b>{statusTag(statuses.FRS)}</b>
              </div>
              <div>
                <span>
                  下一档 ERS {formatMoney(ERS)}（{Math.round(nowX)}%）
                </span>
                <b>{statusTag(statuses.ERS)}</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ProgressSvg({
  marks,
  solid,
  overshoot,
  ticks = [],
  now,
}: {
  marks: Array<{
    key: string;
    label: string;
    sub: string;
    x: number;
    end?: boolean;
  }>;
  solid: number;
  overshoot: number;
  ticks?: number[];
  now: { x: number; label: string } | null;
}) {
  const W = 1000;
  const labelH = 34;
  const barY = labelH;
  const barH = 16;
  const nowH = 18;
  const H = barY + barH + (now ? nowH : 4);
  const patternId = `c2-over-${marks.map((m) => m.key).join("")}`;

  return (
    <svg
      className={"k-progressSvg"}
      viewBox={`0 0 ${W} ${H}`}
      role="presentation"
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect width="6" height="6" className={"k-overPatBg"} />
          <rect width="3" height="6" className={"k-overPatFg"} />
        </pattern>
        <clipPath id={`${patternId}-clip`}>
          <rect x={0} y={barY} width={W} height={barH} rx={barH / 2} />
        </clipPath>
      </defs>

      {marks.map((m) => {
        const x = (m.x / 100) * W;
        const anchor = m.end ? "end" : "middle";
        return (
          <g key={m.key}>
            <text x={x} y={11} textAnchor={anchor} className={"k-tkText"}>
              <tspan x={x} dy="0" className={"k-tkBold"}>
                {m.label}
              </tspan>
              <tspan x={x} dy="12">
                {m.sub}
              </tspan>
            </text>
            <line
              x1={x}
              x2={x}
              y1={labelH - 5}
              y2={labelH}
              className={"k-tkStem"}
            />
          </g>
        );
      })}

      <g clipPath={`url(#${patternId}-clip)`}>
        <rect
          x={0}
          y={barY}
          width={W}
          height={barH}
          className={"k-barTrack"}
        />
        <rect
          x={0}
          y={barY}
          width={(Math.min(100, solid) / 100) * W}
          height={barH}
          className={"k-barFill"}
        />
        {overshoot > 0 ? (
          <rect
            x={(solid / 100) * W}
            y={barY}
            width={(overshoot / 100) * W}
            height={barH}
            fill={`url(#${patternId})`}
          />
        ) : null}
        {ticks.map((t) => (
          <rect
            key={t}
            x={(t / 100) * W - 1.5}
            y={barY}
            width={3}
            height={barH}
            className={"k-barTick"}
          />
        ))}
      </g>

      {now ? (
        <text
          x={(now.x / 100) * W}
          y={barY + barH + 14}
          textAnchor="middle"
          className={"k-nowText"}
        >
          {now.label}
        </text>
      ) : null}
    </svg>
  );
}
