import { asBankNumber, bankProgressFill, formatBankProgressPct } from "./bankFormat";

/** 银行进度条：正常绿 / 落后橙 / 超标红斜纹；含 progressbar a11y。 */
export function BankProgressBar({
  progress,
  warn = false,
  className = "",
  label,
}: {
  progress: number | null | undefined;
  /** status=behind 且未超标时用橙色条 */
  warn?: boolean;
  className?: string;
  /** 可选可读标签；缺省用「进度 xx%」 */
  label?: string;
}) {
  const fill = bankProgressFill(progress);
  const n = asBankNumber(progress);
  const rawPct = n === null ? 0 : Math.round(n);
  // 超过 100% 时 aria-valuenow 不超出 aria-valuemax；valuetext 写真实百分比
  const valueNow = Math.min(100, Math.max(0, rawPct));
  const valueText = formatBankProgressPct(n === null ? 0 : n);
  const ariaLabel = label ?? `进度 ${valueText}`;
  const a11y = {
    role: "progressbar" as const,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": valueNow,
    "aria-valuetext": valueText,
    "aria-label": ariaLabel,
  };

  if (fill.withinPct <= 0 && !fill.over) {
    return <div className={`k-bankBar ${className}`.trim()} {...a11y} />;
  }

  const warnClass = warn && !fill.over ? "k-bankBarWarn" : "";
  if (fill.over) {
    const total = 100 + fill.overshootPct;
    const withinShare = (100 / total) * 100;
    const overShare = (fill.overshootPct / total) * 100;
    return (
      <div className={`k-bankBar ${warnClass} ${className}`.trim()} {...a11y}>
        <i
          className={"k-bankBarF k-bankBarFull"}
          style={{ width: `${withinShare}%` }}
        />
        <i className={"k-bankBarO"} style={{ width: `${overShare}%` }} />
        <span
          className={"k-bankBarTick"}
          style={{ left: `${withinShare}%` }}
        />
      </div>
    );
  }

  return (
    <div className={`k-bankBar ${warnClass} ${className}`.trim()} {...a11y}>
      <i
        className={"k-bankBarF k-bankBarOnly"}
        style={{ width: `${fill.withinPct}%` }}
      />
    </div>
  );
}
