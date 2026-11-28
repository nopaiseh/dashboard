import { BankProgressBar } from "./BankProgressBar";
import { BankStatusChip } from "./BankStatusChip";
import {
  BANK_EMPTY,
  BANK_NOT_STARTED,
  bankCompareArrow,
  bankCompareTone,
  formatBankCompare,
  formatBankMoney,
  formatBankProgressPct,
  isBankNetNegative,
  isBankProgressOver,
  splitBankConclusionTitle,
} from "./bankFormat";
import type { BankViewModel } from "./bankModel";
import { BANK_ACCOUNT_COLORS } from "./bankTheme";
import { EmptyBlock } from "./EmptyBlock";

export function BankOverview({
  model,
  sampleMode = false,
}: {
  model: BankViewModel;
  sampleMode?: boolean;
}) {
  return (
    <div className={"k-bankPanel"}>
      <ConclusionCard model={model} sampleMode={sampleMode} />
      <NetStats model={model} />
      <AccountsTable model={model} sampleMode={sampleMode} />
      <LiabAndTodos model={model} sampleMode={sampleMode} />
    </div>
  );
}

function ConclusionCard({
  model,
  sampleMode,
}: {
  model: BankViewModel;
  sampleMode: boolean;
}) {
  const c = model.conclusion;
  if (!c?.title) {
    return <EmptyBlock title="银行户口 · 结论" message="暂无结论" />;
  }
  const parts = splitBankConclusionTitle(c.title);
  return (
    <section className={"hl k-bankHl"} aria-labelledby="bank-conclusion">
      <div className={"k"}>
        银行户口 · 结论
        {sampleMode ? (
          <span className={"chip chipSample"}>示意数据</span>
        ) : null}
      </div>
      <h1 id="bank-conclusion">
        {parts.map((p, i) =>
          p.danger ? (
            <em key={i}>{p.text}</em>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </h1>
      {c.body ? <p>{c.body}</p> : null}
      {c.urgent ? (
        <p className={"k-bankUrgent"}>
          <span className={"chip chipRed"}>最紧</span>
          {c.urgent}
        </p>
      ) : null}
    </section>
  );
}

function NetStats({ model }: { model: BankViewModel }) {
  const net = model.net;
  if (!net) {
    return (
      <div className={"k-bankStats"} style={{ marginTop: "0.9rem" }}>
        <EmptyBlock message="暂无净额数据" />
      </div>
    );
  }
  const neg = isBankNetNegative(net.net);
  return (
    <div className={"k-bankStats"}>
      <div className={neg ? "k-bankStat k-bankStatNeg" : "k-bankStat"}>
        <div className={"lb"}>净额</div>
        <b className={neg ? "neg" : undefined}>{formatBankMoney(net.net)}</b>
      </div>
      <div className={"k-bankStat"}>
        <div className={"lb"}>现金合计</div>
        <b>{formatBankMoney(net.cashTotal)}</b>
      </div>
      <div className={"k-bankStat"}>
        <div className={"lb"}>负债合计</div>
        <b>{formatBankMoney(net.liabTotal)}</b>
      </div>
    </div>
  );
}

function AccountsTable({
  model,
  sampleMode,
}: {
  model: BankViewModel;
  sampleMode: boolean;
}) {
  if (model.groups.length === 0) {
    return (
      <>
        <div className={"k-sec"}>
          <h2>
            户口余额
            {sampleMode ? (
              <span className={"chip chipSample"}>示意数据</span>
            ) : null}
          </h2>
        </div>
        <EmptyBlock message="暂无户口余额" />
      </>
    );
  }

  const asOfLabel = model.asOf
    ? model.asOf.startsWith("截至")
      ? model.asOf
      : `截至 ${model.asOf}`
    : "";

  return (
    <>
      <div className={"k-sec"}>
        <h2>
          户口余额
          {sampleMode ? (
            <span className={"chip chipSample"}>示意数据</span>
          ) : null}
        </h2>
        {asOfLabel ? <span className={"r"}>{asOfLabel}</span> : null}
      </div>
      <div className={"k-bankDl"}>
        {model.groups.map((g) => (
          <div key={g.id}>
            <div className={"k-bankGh"}>
              <span>{g.label}</span>
              <small>
                小计{" "}
                {g.subtotal === null ? BANK_EMPTY : formatBankMoney(g.subtotal)}
              </small>
            </div>
            {g.accounts.map((acc) => {
              const color = BANK_ACCOUNT_COLORS[acc.accountKey];
              const prog = acc.progress;
              const noTarget = prog?.status === "no_target";
              const over = prog ? isBankProgressOver(prog.progress) : false;
              const warn = prog?.status === "behind" && !over;
              return (
                <div key={acc.accountKey} className={"k-bankDr"}>
                  <div className={"nm"}>
                    <b>
                      <span
                        className={"k-bankSw"}
                        style={{ background: color }}
                        aria-hidden="true"
                      />
                      {acc.name}
                    </b>
                    {acc.roleTag ? <small>{acc.roleTag}</small> : null}
                  </div>
                  <div
                    className={
                      acc.value === null ? "v empty" : "v"
                    }
                    style={{ textAlign: "right" }}
                  >
                    {formatBankMoney(acc.value)}
                  </div>
                  <div className={"c"}>
                    {acc.value !== null ? (
                      <>
                        <span>
                          比上月{" "}
                          <CompareValue value={acc.deltaMom} />
                        </span>
                        <span>
                          比年初{" "}
                          <CompareValue value={acc.ytd} />
                        </span>
                      </>
                    ) : null}
                  </div>
                  {prog ? (
                    noTarget ? (
                      <div className={"k-bankIp nt"}>
                        <span>{BANK_NOT_STARTED}</span>
                        <BankStatusChip
                          status={prog.status}
                          progress={prog.progress}
                          statusText={prog.statusText}
                        />
                      </div>
                    ) : (
                      <div className={"k-bankIp"}>
                        <BankProgressBar
                          progress={prog.progress}
                          warn={warn}
                        />
                        <span
                          className={
                            over ? "pct neg" : "pct"
                          }
                        >
                          {formatBankProgressPct(prog.progress, {
                            hasTarget: true,
                          })}
                        </span>
                        <BankStatusChip
                          status={prog.status}
                          progress={prog.progress}
                          statusText={prog.statusText}
                        />
                      </div>
                    )
                  ) : (
                    <div className={"k-bankIp nt"}>
                      <span>{BANK_NOT_STARTED}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

function CompareValue({ value }: { value: number | undefined }) {
  if (value === undefined) {
    return <b className={"mut"}>—</b>;
  }
  const tone = bankCompareTone(value);
  const arrow = bankCompareArrow(value);
  const cls =
    tone === "pos" ? "pos" : tone === "neg" ? "neg" : "mut";
  return (
    <b className={cls}>
      {arrow ? `${arrow} ` : ""}
      {formatBankCompare(value)}
    </b>
  );
}

function LiabAndTodos({
  model,
  sampleMode,
}: {
  model: BankViewModel;
  sampleMode: boolean;
}) {
  const liab = model.liab;
  const todos = model.todos;
  const liabTotal =
    liab && liab.length > 0
      ? liab.reduce((s, x) => s + x.amount, 0)
      : model.net?.liabTotal;

  return (
    <>
      <div className={"k-sec"}>
        <h2>
          负债与待办
          {sampleMode ? (
            <span className={"chip chipSample"}>示意数据</span>
          ) : null}
        </h2>
      </div>
      <div className={"k-bankGrid2"}>
        <div className={"card"}>
          <h3>待扣负债</h3>
          {!liab || liab.length === 0 ? (
            <p className={"mut"} style={{ margin: "0.5rem 0 0" }}>
              {BANK_EMPTY}
            </p>
          ) : (
            <div className={"k-bankRo sep"}>
              {liab.map((row) => (
                <div key={`${row.title}-${row.due}`}>
                  <span>
                    {row.title}{" "}
                    <small className={"mut"}>到期 {row.due}</small>
                  </span>
                  <b>{formatBankMoney(row.amount)}</b>
                </div>
              ))}
              <div>
                <span>
                  <b>负债合计</b>
                </span>
                <b>
                  {liabTotal == null
                    ? BANK_EMPTY
                    : formatBankMoney(liabTotal)}
                </b>
              </div>
            </div>
          )}
        </div>
        <div className={"card"}>
          <h3>待办</h3>
          {!todos || todos.length === 0 ? (
            <p className={"mut"} style={{ margin: "0.5rem 0 0" }}>
              {BANK_EMPTY}
            </p>
          ) : (
            <ul className={"k-bankPl k-bankTodo"}>
              {todos.map((t, i) => (
                <li key={`todo-${i}-${t.title}`}>{t.title}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
