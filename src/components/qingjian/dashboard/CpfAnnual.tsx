import { EmptyBlock } from "./EmptyBlock";
import type { CpfAnnualData } from "./cpfModel";
import { formatMoney } from "./format";

export function CpfAnnual({
  data,
  sampleMode = false,
}: {
  data: CpfAnnualData | null;
  sampleMode?: boolean;
}) {
  if (!data) {
    return (
      <>
        <div className={"k-sec"}>
          <h2>
            年度
            {sampleMode ? (
              <span className={"chip chipSample"}>示例数据</span>
            ) : null}
          </h2>
        </div>
        <EmptyBlock message="暂无年度数据" />
      </>
    );
  }

  const showRates = data.showRates;

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
          <h2>{data.yearLabel}</h2>
          <div className={"k-tblScroll"}>
            <table className={"k-tbl"}>
              <thead>
                <tr>
                  <th className={"l"}>户口</th>
                  {showRates ? <th>当年利率</th> : null}
                  <th>入账利息</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={"l"}>OA</td>
                  {showRates ? <td>{data.rates.OA}</td> : null}
                  <td>
                    <b>{formatMoney(data.interest.OA)}</b>
                  </td>
                </tr>
                <tr>
                  <td className={"l"}>SA</td>
                  {showRates ? <td>{data.rates.SA}</td> : null}
                  <td>
                    <b>{formatMoney(data.interest.SA)}</b>
                  </td>
                </tr>
                <tr>
                  <td className={"l"}>MA</td>
                  {showRates ? <td>{data.rates.MA}</td> : null}
                  <td>
                    <b>{formatMoney(data.interest.MA)}</b>
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td className={"l"}>合计</td>
                  {showRates ? <td /> : null}
                  <td>{formatMoney(data.interestTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {data.note ? <div className={"k-mini"}>{data.note}</div> : null}
        </div>

        <div className={"card"}>
          <div className={"k-rstuHead"}>
            <h2>RSTU 自愿填补</h2>
            <div className={"k-rstuTags"}>
              {data.rstuPaidLabel ? (
                <span
                  className={
                    data.rstuPaidPositive ? "chip chipOver" : "chip chipNeutral"
                  }
                >
                  {data.rstuPaidLabel}
                </span>
              ) : null}
              {data.rstuDueChip ? (
                <span className={"chip chipNeutral"}>{data.rstuDueChip}</span>
              ) : null}
            </div>
          </div>
          {data.rstuEmpty ? (
            <div className={"k-empty"}>
              <b>{data.rstuTitle ?? "本年未填补"}</b>
              {data.rstuBody ? <p>{data.rstuBody}</p> : null}
              {data.rstuExtra ? (
                <p className={"k-emptyExtra"}>{data.rstuExtra}</p>
              ) : null}
            </div>
          ) : data.rstuBody ? (
            <div className={"k-rstuBody"}>
              {data.rstuTitle && data.rstuTitle !== "本年未填补" ? (
                <b>{data.rstuTitle}</b>
              ) : null}
              <p>{data.rstuBody}</p>
              {data.rstuExtra ? (
                <p className={"k-emptyExtra"}>{data.rstuExtra}</p>
              ) : null}
            </div>
          ) : (
            <EmptyBlock message="暂无 RSTU 记录" />
          )}
        </div>
      </div>
    </>
  );
}
