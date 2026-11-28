import { EmptyBlock } from "./EmptyBlock";
import type { CpfContribData } from "./cpfModel";
import { formatMoney } from "./format";

export function CpfContrib({
  data,
  sampleMode = false,
}: {
  data: CpfContribData | null;
  sampleMode?: boolean;
}) {
  if (!data) {
    return (
      <>
        <div className={"k-sec"}>
          <h2>
            本月缴存
            {sampleMode ? (
              <span className={"chip chipSample"}>示例数据</span>
            ) : null}
          </h2>
        </div>
        <EmptyBlock message="暂无本月缴存" />
      </>
    );
  }

  const c = data;
  return (
    <>
      <div className={"k-sec"}>
        <h2>
          本月缴存
          {sampleMode ? (
            <span className={"chip chipSample"}>示例数据</span>
          ) : null}
        </h2>
        <span className={"r"}>
          {c.asOfMonth}
          {c.asOfMonth ? "入账" : ""}
        </span>
      </div>
      <div className={"card"}>
        <div className={"k-tblScroll"}>
          <table className={"k-tbl"}>
            <thead>
              <tr className={"grp"}>
                <th colSpan={3}>来源</th>
                <th colSpan={3}>分户口</th>
                <th>年度上限剩余</th>
              </tr>
              <tr>
                <th>雇主</th>
                <th>本人</th>
                <th>合计</th>
                <th>OA</th>
                <th>SA</th>
                <th>MA</th>
                <th>已缴 {formatMoney(c.paidYtd)} · 剩余</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatMoney(c.employer)}</td>
                <td>{formatMoney(c.self)}</td>
                <td>
                  <b>{formatMoney(c.total)}</b>
                </td>
                <td>{formatMoney(c.OA)}</td>
                <td>{formatMoney(c.SA)}</td>
                <td>{formatMoney(c.MA)}</td>
                <td>
                  <b>{formatMoney(c.limitLeft)}</b>
                  <span className={"k-yr"}>
                    {" "}
                    / {formatMoney(c.annualLimit)}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {c.note ? <div className={"k-mini"}>{c.note}</div> : null}
      </div>
    </>
  );
}
