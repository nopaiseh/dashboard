import {
  asBankNumber,
  BANK_EMPTY,
  bankProgressFill,
  formatBankProgressPct,
} from "./bankFormat";

/** 银行进度条：正常绿 / 落后橙 / 超标红斜纹；含 progressbar a11y。 */
export function BankProgressBar({
  progress,
  warn = false,
  className = "",
  label,
  valueText: valueTextProp,
}: {
  progress: number | null | undefined;
  /** status=behind 且未超标时用橙色条 */
  warn?: boolean;
  className?: string;
  /** 可选可读标签；缺省用「进度 xx%」或「暂无数据」 */
  label?: string;
  /**
   * 覆盖 aria-valuetext（如按 unit 读出的「0 个月 / 12 个月」）；
   * 缺省与可见百分比一致。
   */
  valueText?: string;
}) {
  const fill = bankProgressFill(progress);
  const n = asBankNumber(progress);
  const rawPct = n === null ? 0 : Math.round(n);
  // 超过 100% 时 aria-valuenow 不超出 aria-valuemax；valuetext 写真实百分比
  const valueNow = Math.min(100, Math.max(0, rawPct));
  // 缺进度与页面一致读「暂无数据」，不要读成 0%
  const pctText = n === null ? BANK_EMPTY : formatBankProgressPct(n);
  const valueText = valueTextProp ?? pctText;
  const ariaLabel = label ?? (n === null ? BANK_EMPTY : `进度 ${pctText}`);
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
