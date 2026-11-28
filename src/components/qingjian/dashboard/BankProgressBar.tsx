import { bankProgressFill } from "./bankFormat";

/** 银行进度条：正常绿 / 落后橙 / 超标红斜纹。 */
export function BankProgressBar({
  progress,
  warn = false,
  className = "",
}: {
  progress: number | null | undefined;
  /** status=behind 且未超标时用橙色条 */
  warn?: boolean;
  className?: string;
}) {
  const fill = bankProgressFill(progress);
  if (fill.withinPct <= 0 && !fill.over) {
    return <div className={`k-bankBar ${className}`.trim()} />;
  }

  const warnClass = warn && !fill.over ? "k-bankBarWarn" : "";
  if (fill.over) {
    const total = 100 + fill.overshootPct;
    const withinShare = (100 / total) * 100;
    const overShare = (fill.overshootPct / total) * 100;
    return (
      <div className={`k-bankBar ${warnClass} ${className}`.trim()}>
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
    <div className={`k-bankBar ${warnClass} ${className}`.trim()}>
      <i
        className={"k-bankBarF k-bankBarOnly"}
        style={{ width: `${fill.withinPct}%` }}
      />
    </div>
  );
}
