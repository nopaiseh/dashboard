import type { ReactNode } from "react";
import { EmptyBlock } from "./EmptyBlock";
import type { AccBalances, CpfAccountsData } from "./cpfModel";
import { formatMoney } from "./format";

const LABELS = [
  { key: "OA" as const, title: "普通户口 OA", colorClass: "k-sw-oa" },
  { key: "SA" as const, title: "特别户口 SA", colorClass: "k-sw-sa" },
  { key: "MA" as const, title: "保健储蓄 MA", colorClass: "k-sw-ma" },
];

/** 比上月：正 ▲、负 ▼、零无箭头。 */
export function momChangeLabel(value: number): ReactNode {
  if (!Number.isFinite(value) || value === 0) {
    return <>比上月持平</>;
  }
  if (value > 0) {
    return (
      <>
        比上月 <b>▲ {formatMoney(value)}</b>
      </>
    );
  }
  return (
    <>
      比上月 <b>▼ {formatMoney(Math.abs(value))}</b>
    </>
  );
}

/** 比年初：正 +、负 −、零中性。 */
export function ytdChangeLabel(value: number): ReactNode {
  if (!Number.isFinite(value) || value === 0) {
    return <>比年初持平</>;
  }
  if (value > 0) {
    return <>比年初 +{formatMoney(value)}</>;
  }
  return <>比年初 −{formatMoney(Math.abs(value))}</>;
}

export function CpfAccounts({
  data,
  sampleMode = false,
}: {
  data: CpfAccountsData | null;
  sampleMode?: boolean;
}) {
  if (!data) {
    return (
      <>
        <div className={"k-sec"}>
          <h2>
            户口余额
            {sampleMode ? (
              <span className={"chip chipSample"}>示例数据</span>
            ) : null}
          </h2>
        </div>
        <EmptyBlock message="暂无户口余额" />
      </>
    );
  }

  const { balances, chgM, chgY, asOf } = data;
  const total = balances.OA + balances.SA + balances.MA;
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
            <span className={"k-chg"}>{momChangeLabel(chgM[acc.key])}</span>
            <span className={"k-yr"}>{ytdChangeLabel(chgY[acc.key])}</span>
          </div>
        ))}
        <TotalCard
          total={total}
          totalChgM={totalChgM}
          chgY={chgY}
          monthContribTotal={data.monthContribTotal}
          monthInterest={data.monthInterest}
        />
      </div>
    </>
  );
}

function TotalCard({
  total,
  totalChgM,
  chgY,
  monthContribTotal,
  monthInterest,
}: {
  total: number;
  totalChgM: number;
  chgY: AccBalances;
  monthContribTotal?: number;
  monthInterest?: number;
}) {
  const interestBit =
    typeof monthInterest === "number" && monthInterest !== 0
      ? ` · 利息 ${monthInterest.toLocaleString("en-SG")}`
      : "";

  return (
    <div className={"num numEm"}>
      <div className={"lb"}>
        <span>
          合计 <i>OA+SA+MA</i>
        </span>
      </div>
      <b>{formatMoney(total)}</b>
      <span className={"k-chg"}>{momChangeLabel(totalChgM)}</span>
      {monthContribTotal !== undefined ? (
        <span className={"k-yr"}>
          缴存 {monthContribTotal.toLocaleString("en-SG")}
          {interestBit}
        </span>
      ) : null}
      <span className={"k-yr"}>
        {ytdChangeLabel(chgY.OA + chgY.SA + chgY.MA)}
      </span>
    </div>
  );
}
