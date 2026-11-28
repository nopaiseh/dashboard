import { C2_CONTRIB } from "./c2Data";
import { formatMoney } from "./format";

export function CpfContrib({ sampleMode = false }: { sampleMode?: boolean }) {
  const c = C2_CONTRIB;
  return (
    <>
      <div className={"k-sec"}>
        <h2>
          本月缴存
          {sampleMode ? (
            <span className={"chip chipSample"}>示例数据</span>
          ) : null}
        </h2>
        <span className={"r"}>{c.asOfMonth}入账</span>
      </div>
      <div className={"card"}>
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
              <th>
                已缴 {formatMoney(c.paidYtd)} · 剩余
              </th>
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
        <div className={"k-mini"}>{c.note}</div>
      </div>
    </>
  );
}
