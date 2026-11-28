"use client";

import {
  BANK_EMPTY,
  formatBankMoney,
  isBankNetNegative,
} from "./bankFormat";
import type { BankLedgerMonth, BankViewModel } from "./bankModel";
import { BANK_LEDGER_CATEGORY_LABELS } from "./bankTheme";
import { EmptyBlock } from "./EmptyBlock";

/** 流水页：按月倒序折叠；收入/支出条；说明。 */
export function BankLedgerPanel({
  model,
  sampleMode = false,
}: {
  model: BankViewModel;
  sampleMode?: boolean;
}) {
  // 前端按月份倒序（服务端不保证顺序）
  const months = model.ledger
    ? [...model.ledger].sort((a, b) => b.month.localeCompare(a.month))
    : null;

  return (
    <div className={"k-bankPanel"}>
      <div className={"k-sec"}>
        <h2>
          流水
          {sampleMode ? (
            <span className={"chip chipSample"}>示意数据</span>
          ) : null}
        </h2>
        <span className={"r"}>按月倒序 · 只记类别 · 内部转账不计</span>
      </div>

      {!months || months.length === 0 ? (
        <EmptyBlock message="暂无流水" />
      ) : (
        <div className={"k-bankAccWrap"}>
          {months.map((m, idx) => (
            <MonthBlock key={m.month} month={m} defaultOpen={idx === 0} />
          ))}
        </div>
      )}

      <div className={"card"} style={{ marginTop: "0.9rem" }}>
        <h3>说明</h3>
        {!model.assumptions || model.assumptions.length === 0 ? (
          <p className={"mut"} style={{ margin: "0.5rem 0 0" }}>
            {BANK_EMPTY}
          </p>
        ) : (
          <ul className={"k-bankPl"}>
            {model.assumptions.map((line, i) => (
              <li key={`assumption-${i}`}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function MonthBlock({
  month,
  defaultOpen,
}: {
  month: BankLedgerMonth;
  defaultOpen: boolean;
}) {
  const net = month.inTotal - month.outTotal;
  const netNeg = isBankNetNegative(net);
  const inLines = month.lines.filter((l) => l.kind === "in");
  const outLines = month.lines.filter((l) => l.kind === "out");
  const inMax = Math.max(1, ...inLines.map((l) => l.amount));
  const outMax = Math.max(1, ...outLines.map((l) => l.amount));

  const netLabel =
    net === 0
      ? `净 ${formatBankMoney(0, 0)}`
      : net > 0
        ? `净 +${formatBankMoney(net, 0).replace(/^S\$/, "S$")}`
        : `净 ${formatBankMoney(net, 0)}`;

  return (
    <details className={"k-bankMo"} open={defaultOpen}>
      <summary>
        <b>{month.month}</b>
        <span className={"t"}>
          <span>
            收入{" "}
            <b className={"pos"}>{formatBankMoney(month.inTotal, 0)}</b>
          </span>
          <span>
            支出 <b>{formatBankMoney(month.outTotal, 0)}</b>
          </span>
          <span className={netNeg ? "chip chipWarn" : "chip chipOk"}>
            {netLabel}
          </span>
        </span>
      </summary>
      <div className={"in"}>
        <div className={"led"}>
          <h4>收入</h4>
          {inLines.length === 0 ? (
            <p className={"mut"} style={{ fontSize: "0.8125rem" }}>
              {BANK_EMPTY}
            </p>
          ) : (
            inLines.map((line) => (
              <LedgerLine
                key={`in-${line.category}-${line.amount}`}
                label={categoryLabel(line.category)}
                amount={line.amount}
                max={inMax}
                tone="in"
              />
            ))
          )}
        </div>
        <div className={"led"}>
          <h4>支出</h4>
          {outLines.length === 0 ? (
            <p className={"mut"} style={{ fontSize: "0.8125rem" }}>
              {BANK_EMPTY}
            </p>
          ) : (
            outLines.map((line) => (
              <LedgerLine
                key={`out-${line.category}-${line.amount}`}
                label={categoryLabel(line.category)}
                amount={line.amount}
                max={outMax}
                tone="out"
              />
            ))
          )}
        </div>
      </div>
    </details>
  );
}

function categoryLabel(category: string): string {
  return BANK_LEDGER_CATEGORY_LABELS[category] ?? category;
}

function LedgerLine({
  label,
  amount,
  max,
  tone,
}: {
  label: string;
  amount: number;
  max: number;
  tone: "in" | "out";
}) {
  const pct = Math.max(3, Math.round((amount / max) * 100));
  const color = tone === "in" ? "#2d5a47" : "#c08a3e";
  return (
    <div className={"ln"}>
      <span>{label}</span>
      <div className={"b"}>
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
      <em>{formatBankMoney(amount, 0)}</em>
    </div>
  );
}
