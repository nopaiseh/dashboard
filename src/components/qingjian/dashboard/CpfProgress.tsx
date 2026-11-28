import {
  C2_BAL,
  C2_EXCEED_FRS,
  C2_HIT,
  C2_OA_SA,
  C2_TARGETS,
} from "./c2Data";
import { formatMoney } from "./format";

/**
 * 方案甲：两条细进度条（C2 定稿）。
 * 刻度标签在条上方对齐；白线刻度在条内；超出段斜纹。
 * 动态几何用 SVG 属性，避免 CSP 禁止的 style={{}}。
 */
export function CpfProgress({ sampleMode = false }: { sampleMode?: boolean }) {
  const ma = C2_BAL.MA;
  const bhs = C2_TARGETS.BHS;
  const maPct = Math.min(100, (ma / bhs) * 100);

  const oaSa = C2_OA_SA;
  const { BRS, FRS, ERS } = C2_TARGETS;
  // Track = 0 … ERS; FRS at 50%, BRS at 25%
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
          {/* MA vs BHS */}
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
                marks={[{ key: "BHS", label: "BHS", sub: "7.5万", x: 100, end: true }]}
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
              <div>
                <span>估算 达 BHS</span>
                <b>约 {C2_HIT.BHS}</b>
              </div>
            </div>
          </div>

          <hr className={"k-hr"} />

          {/* SA+OA vs tiers */}
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
                  { key: "ERS", label: "ERS", sub: "44万", x: 100, end: true },
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
                  <span className={"chip chipOver"}>已达 · {C2_HIT.BRS}</span>
                </b>
              </div>
              <div>
                <span>
                  FRS {formatMoney(FRS)}（{Math.round((oaSa / FRS) * 100)}%）
                </span>
                <b>
                  <span className={"chip chipOver"}>
                    已达，超出 {formatMoney(C2_EXCEED_FRS)}
                  </span>
                </b>
              </div>
              <div>
                <span>
                  下一档 ERS {formatMoney(ERS)}（{Math.round(nowX)}%）
                </span>
                <b>
                  <span className={"chip chipNext"}>约 {C2_HIT.ERS}</span>
                </b>
              </div>
            </div>
          </div>
        </div>
        <div className={"k-mini"}>
          目标值为示例：BHS {formatMoney(C2_TARGETS.BHS)}、BRS{" "}
          {formatMoney(BRS)}、FRS {formatMoney(FRS)}、ERS {formatMoney(ERS)}
          。越过的档位按实际比例显示（不卡在 100%），超出部分用斜纹标出，并指向下一档。达标年月为估算，目标按当前值计，不含每年上调。
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
  marks: Array<{ key: string; label: string; sub: string; x: number; end?: boolean }>;
  solid: number;
  overshoot: number;
  ticks?: number[];
  now: { x: number; label: string } | null;
}) {
  // Geometry mirrors C2 HTML: 16px bar, labels above with 5px stem, now label below.
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
