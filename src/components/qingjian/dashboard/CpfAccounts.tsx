import {
  C2_BAL,
  C2_CHG_M,
  C2_CHG_Y,
  C2_CONTRIB,
  C2_TOTAL,
  type AccBalances,
} from "./c2Data";
import { formatMoney } from "./format";

const LABELS = [
  { key: "OA" as const, title: "普通户口 OA", colorClass: "k-sw-oa" },
  { key: "SA" as const, title: "特别户口 SA", colorClass: "k-sw-sa" },
  { key: "MA" as const, title: "保健储蓄 MA", colorClass: "k-sw-ma" },
];

export function CpfAccounts({
  balances = C2_BAL,
  chgM = C2_CHG_M,
  chgY = C2_CHG_Y,
  asOf = "截至结算单 2026-10-31",
  sampleMode = false,
}: {
  balances?: AccBalances;
  chgM?: AccBalances;
  chgY?: AccBalances;
  asOf?: string;
  sampleMode?: boolean;
}) {
  const total = balances.OA + balances.SA + balances.MA || C2_TOTAL;
  const totalChgM = chgM.OA + chgM.SA + chgM.MA;

  return (
    <>
      <div className={"k-sec"}>
        <h2>
          户口余额
          {sampleMode ? (
            <span className={"chip chipSample"}>示例数据</span>
          ) : null}
        </h2>
        <span className={"r"}>{asOf}</span>
      </div>
      <div className={"k-acc"}>
        {LABELS.map((acc) => (
          <div key={acc.key} className={"num"}>
            <div className={"lb"}>
              <span>
                <i className={`k-sw ${acc.colorClass}`} aria-hidden="true" />
                {acc.title}
              </span>
            </div>
            <b>{formatMoney(balances[acc.key])}</b>
            <span className={"k-chg"}>
              比上月 <b>▲ {formatMoney(chgM[acc.key])}</b>
            </span>
            <span className={"k-yr"}>
              比年初 +{formatMoney(chgY[acc.key])}
            </span>
          </div>
        ))}
        <div className={"num numEm"}>
          <div className={"lb"}>
            <span>
              合计 <i>OA+SA+MA</i>
            </span>
          </div>
          <b>{formatMoney(total)}</b>
          <span className={"k-chg"}>
            比上月 <b>▲ {formatMoney(totalChgM)}</b>
          </span>
          <span className={"k-yr"}>
            缴存 {C2_CONTRIB.total.toLocaleString("en-SG")} · 利息 0
          </span>
          <span className={"k-yr"}>
            比年初 +{formatMoney(chgY.OA + chgY.SA + chgY.MA)}
          </span>
        </div>
      </div>
    </>
  );
}
