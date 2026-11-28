import { EmptyBlock } from "./EmptyBlock";
import type { AccBalances, CpfAccountsData } from "./cpfModel";
import { formatMoney } from "./format";

const LABELS = [
  { key: "OA" as const, title: "普通户口 OA", colorClass: "k-sw-oa" },
  { key: "SA" as const, title: "特别户口 SA", colorClass: "k-sw-sa" },
  { key: "MA" as const, title: "保健储蓄 MA", colorClass: "k-sw-ma" },
];

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
            <span className={"k-chg"}>
              比上月 <b>▲ {formatMoney(chgM[acc.key])}</b>
            </span>
            <span className={"k-yr"}>
              比年初 +{formatMoney(chgY[acc.key])}
            </span>
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
  return (
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
      {monthContribTotal !== undefined ? (
        <span className={"k-yr"}>
          缴存 {monthContribTotal.toLocaleString("en-SG")} · 利息{" "}
          {(monthInterest ?? 0).toLocaleString("en-SG")}
        </span>
      ) : null}
      <span className={"k-yr"}>
        比年初 +{formatMoney(chgY.OA + chgY.SA + chgY.MA)}
      </span>
    </div>
  );
}
