import { BankProgressBar } from "./BankProgressBar";
import { BankStatusChip } from "./BankStatusChip";
import {
  BANK_EMPTY,
  BANK_NOT_STARTED,
  bankAllocFill,
  formatBankMilestoneLabel,
  formatBankMoney,
  formatBankOvershootLabel,
  formatBankProgressPct,
  formatBankProgressValue,
  isBankProgressOver,
} from "./bankFormat";
import type { BankProgressItem, BankViewModel } from "./bankModel";
import {
  BANK_ALLOC_STATUS_LABELS,
  BANK_ACCOUNT_COLORS,
} from "./bankTheme";
import { EmptyBlock } from "./EmptyBlock";

/** 目标页：进度列表 + 拨款计划。 */
export function BankGoals({
  model,
  sampleMode = false,
}: {
  model: BankViewModel;
  sampleMode?: boolean;
}) {
  return (
    <div className={"k-bankPanel"}>
      <GoalsList model={model} sampleMode={sampleMode} />
      <AllocCard model={model} sampleMode={sampleMode} />
    </div>
  );
}

function GoalsList({
  model,
  sampleMode,
}: {
  model: BankViewModel;
  sampleMode: boolean;
}) {
  const items = orderedProgress(model);
  if (items.length === 0) {
    return (
      <>
        <div className={"k-sec"}>
          <h2>
            年度目标
            {sampleMode ? (
              <span className={"chip chipSample"}>示意数据</span>
            ) : null}
          </h2>
          <span className={"r"}>按户口 · 含每月需存、截止与里程碑</span>
        </div>
        <EmptyBlock message="暂无目标" />
      </>
    );
  }

  return (
    <>
      <div className={"k-sec"}>
        <h2>
          年度目标
          {sampleMode ? (
            <span className={"chip chipSample"}>示意数据</span>
          ) : null}
        </h2>
        <span className={"r"}>按户口 · 含每月需存、截止与里程碑</span>
      </div>
      <div className={"card"} style={{ padding: 0 }}>
        {items.map((item) => (
          <GoalRow key={item.key} item={item} model={model} />
        ))}
      </div>
    </>
  );
}

function orderedProgress(model: BankViewModel): BankProgressItem[] {
  // 与概览户口顺序一致：按分组内账户顺序，再挂 progress
  const order: string[] = [];
  for (const g of model.groups) {
    for (const a of g.accounts) order.push(a.accountKey);
  }
  const byAcc = new Map(model.progress.map((p) => [p.accountKey, p]));
  const seen = new Set<string>();
  const out: BankProgressItem[] = [];
  for (const key of order) {
    const p = byAcc.get(key as never);
    if (p && !seen.has(p.key)) {
      seen.add(p.key);
      out.push(p);
    }
  }
  for (const p of model.progress) {
    if (!seen.has(p.key)) out.push(p);
  }
  return out;
}

function accountName(
  model: BankViewModel,
  accountKey: string,
): string {
  for (const g of model.groups) {
    for (const a of g.accounts) {
      if (a.accountKey === accountKey) return a.name;
    }
  }
  return accountKey;
}

function GoalRow({
  item,
  model,
}: {
  item: BankProgressItem;
  model: BankViewModel;
}) {
  const noTarget = item.status === "no_target";
  const over = isBankProgressOver(item.progress);
  const warn = item.status === "behind" && !over;
  const accName = accountName(model, item.accountKey);
  const dueBit = item.due ? ` · 截止 ${item.due}` : "";
  const currentLabel = formatBankProgressValue(item.value, item.unit);
  const targetLabel = formatBankProgressValue(item.target, item.unit);
  const rangeText = `${currentLabel} / ${targetLabel}`;

  return (
    <div className={noTarget ? "k-bankGr nt" : "k-bankGr"}>
      <h4>
        {item.title}
        <small>
          {accName}
          {dueBit}
        </small>
      </h4>
      {noTarget ? (
        <div className={"k-bankNostart"}>{BANK_NOT_STARTED}</div>
      ) : (
        <div>
          <BankProgressBar
            progress={item.progress}
            warn={warn}
            valueText={rangeText}
            label={`${item.title} ${rangeText}`}
          />
          <div style={{ marginTop: "0.45rem" }}>
            <BankStatusChip
              status={item.status}
              progress={item.progress}
              statusText={item.statusText}
            />
          </div>
          {item.milestones.length > 0 ? (
            <div className={"k-bankMs"}>
              {item.milestones.map((m) => (
                <span key={`${m.t}-${m.amount}`}>
                  {formatBankMilestoneLabel(m.t, m.amount, item.unit)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
      <div className={"k-bankRd"}>
        {noTarget ? (
          <div>
            <span>状态</span>
            <b>{item.statusText || BANK_NOT_STARTED}</b>
          </div>
        ) : (
          <>
            <div>
              <span>当前 / 目标</span>
              <b className={over ? "neg" : undefined}>{rangeText}</b>
            </div>
            <div>
              <span>进度</span>
              <b className={over ? "neg" : undefined}>
                {formatBankProgressPct(item.progress, { hasTarget: true })}
                {over
                  ? ` · ${formatBankOvershootLabel(item.progress)}`
                  : ""}
              </b>
            </div>
            {item.monthlyNeeded != null ? (
              <div>
                <span>每月需存</span>
                <b>{formatBankMoney(item.monthlyNeeded)}</b>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function AllocCard({
  model,
  sampleMode,
}: {
  model: BankViewModel;
  sampleMode: boolean;
}) {
  const alloc = model.alloc;
  if (!alloc) {
    return (
      <div style={{ marginTop: "0.9rem" }}>
        <EmptyBlock title="拨款计划 vs 实际" message={BANK_EMPTY} />
      </div>
    );
  }

  const subtitle =
    alloc.title ||
    (alloc.month ? `拨款月份 ${alloc.month}` : "");

  return (
    <div className={"card"} style={{ marginTop: "0.9rem" }}>
      <h3>
        拨款计划 vs 实际
        {sampleMode ? (
          <span className={"chip chipSample"} style={{ marginLeft: "0.5rem" }}>
            示意数据
          </span>
        ) : null}
      </h3>
      {subtitle ? (
        <p className={"mut"} style={{ margin: "0.25rem 0 0.7rem", fontSize: "0.8rem" }}>
          {subtitle}
        </p>
      ) : null}
      {alloc.rows.length === 0 ? (
        <p className={"mut"}>{BANK_EMPTY}</p>
      ) : (
        <div className={"k-bankAlloc"}>
          {alloc.rows.map((row) => {
            const fill = bankAllocFill(row.planned, row.actual ?? 0);
            const statusLabel =
              BANK_ALLOC_STATUS_LABELS[row.status] ?? row.status;
            const chipCls =
              row.status === "done"
                ? "chip chipOk"
                : row.status === "partial"
                  ? "chip chipWarn"
                  : row.status === "over"
                    ? "chip chipRed"
                    : "chip chipNeutral";
            const over = fill.over;
            return (
              <div key={`${row.accountKey}-${row.label}`} className={"row"}>
                <span className={"t"}>
                  <span
                    className={"k-bankSw"}
                    style={{
                      background:
                        BANK_ACCOUNT_COLORS[row.accountKey] ?? "#94a3b8",
                    }}
                    aria-hidden="true"
                  />
                  {row.label}
                </span>
                <div className={"bw"} style={{ minWidth: 0 }}>
                  {over ? (
                    <BankProgressBar progress={(row.actual! / row.planned) * 100} />
                  ) : (
                    <BankProgressBar
                      progress={
                        row.planned > 0
                          ? ((row.actual ?? 0) / row.planned) * 100
                          : 0
                      }
                      warn={row.status === "partial"}
                    />
                  )}
                </div>
                <span className={chipCls}>{statusLabel}</span>
                <span className={"n"} style={{ gridColumn: "1 / -1" }}>
                  计划 <b>{formatBankMoney(row.planned)}</b>
                  {" · "}
                  实际{" "}
                  <b className={over ? "neg" : undefined}>
                    {row.actual === undefined
                      ? BANK_EMPTY
                      : formatBankMoney(row.actual)}
                  </b>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
