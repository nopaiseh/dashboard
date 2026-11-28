import { C2_INT_JAN, C2_INT_TOTAL, C2_RATES } from "./c2Data";
import { formatMoney } from "./format";

export function CpfAnnual({ sampleMode = false }: { sampleMode?: boolean }) {
  return (
    <>
      <div className={"k-sec"}>
        <h2>
          年度
          {sampleMode ? (
            <span className={"chip chipSample"}>示例数据</span>
          ) : null}
        </h2>
        <span className={"r"}>每年 1 月利息入账 · 12-31 RSTU 截止</span>
      </div>
      <div className={"k-two"}>
        <div className={"card"}>
          <h2>
            2026 年 1 月入账的利息{" "}
            <span className={"k-yr"}>（2025 年度）</span>
          </h2>
          <table className={"k-tbl"}>
            <thead>
              <tr>
                <th className={"l"}>户口</th>
                <th>当年利率</th>
                <th>入账利息</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={"l"}>OA</td>
                <td>{(C2_RATES.OA * 100).toFixed(1)}%</td>
                <td>
                  <b>{formatMoney(C2_INT_JAN.OA)}</b>
                </td>
              </tr>
              <tr>
                <td className={"l"}>SA</td>
                <td>4.0% + 额外 1%</td>
                <td>
                  <b>{formatMoney(C2_INT_JAN.SA)}</b>
                </td>
              </tr>
              <tr>
                <td className={"l"}>MA</td>
                <td>4.0%</td>
                <td>
                  <b>{formatMoney(C2_INT_JAN.MA)}</b>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td className={"l"}>合计</td>
                <td />
                <td>{formatMoney(C2_INT_TOTAL)}</td>
              </tr>
            </tfoot>
          </table>
          <div className={"k-mini"}>
            每年 1 月入账一次，下次 2027 年 1 月。头 S$ 60,000 的额外 1%
            计入 SA。利息栏通常只显示合计；示例里 2020 年在「全部」走势图的悬停提示中拆成基本利息
            + 额外利息。
          </div>
        </div>

        <div className={"card"}>
          <div className={"k-rstuHead"}>
            <h2>RSTU 自愿填补</h2>
            <span className={"chip chipNeutral"}>12-31 截止</span>
          </div>
          <div className={"k-empty"}>
            <b>本年未填补</b>
            <p>今年还没有自愿填补。上限 S$ 8,000，税务减免尚未使用。</p>
            <p className={"k-emptyExtra"}>
              12-31 截止。应急金和信用卡还清优先。
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
