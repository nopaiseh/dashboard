import { EmptyBlock } from "./EmptyBlock";
import type { CpfProgressData } from "./cpfModel";
import { formatMoney } from "./format";

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
    hitBhs,
    hitBrs,
    hitErs,
    footnote,
  } = data;
  const maPct = Math.min(100, (ma / bhs) * 100);
  const brsX = (BRS / ERS) * 100;
  const frsX = (FRS / ERS) * 100;
  const nowX = Math.min(100, (oaSa / ERS) * 100);
  const solidToFrs = frsX;
  const overshootW = Math.max(0, nowX - frsX);

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
                  { key: "BHS", label: "BHS", sub: "7.5万", x: 100, end: true },
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
              aria-label={`SA 加 OA 已达 FRS 的 ${Math.round((oaSa / FRS) * 100)}%，下一档 ERS 已达 ${Math.round(nowX)}%`}
            >
              <ProgressSvg
                marks={[
                  { key: "BRS", label: "BRS", sub: "11万", x: brsX },
                  { key: "FRS", label: "FRS", sub: "22万", x: frsX },
                  {
                    key: "ERS",
                    label: "ERS",
                    sub: "44万",
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
                  BRS {formatMoney(BRS)}（{Math.round((oaSa / BRS) * 100)}%）
                </span>
                <b>
                  {hitBrs ? (
                    <span className={"chip chipOver"}>已达 · {hitBrs}</span>
                  ) : null}
                </b>
              </div>
              <div>
                <span>
                  FRS {formatMoney(FRS)}（{Math.round((oaSa / FRS) * 100)}%）
                </span>
                <b>
                  {oaSa >= FRS ? (
                    <span className={"chip chipOver"}>
                      已达，超出 {formatMoney(exceedFrs)}
                    </span>
                  ) : null}
                </b>
              </div>
              <div>
                <span>
                  下一档 ERS {formatMoney(ERS)}（{Math.round(nowX)}%）
                </span>
                <b>
                  {hitErs ? (
                    <span className={"chip chipNext"}>约 {hitErs}</span>
                  ) : null}
                </b>
              </div>
            </div>
          </div>
        </div>
        {footnote ? <div className={"k-mini"}>{footnote}</div> : null}
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
