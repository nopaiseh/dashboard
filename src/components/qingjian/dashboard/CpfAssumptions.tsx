import { EmptyBlock } from "./EmptyBlock";
import type { CpfAssumptionsData } from "./cpfModel";

export function CpfAssumptions({ data }: { data: CpfAssumptionsData | null }) {
  if (!data) {
    return <EmptyBlock title="估算说明" message="暂无估算说明" />;
  }

  return (
    <div className={"note"}>
      <h3>估算说明</h3>
      <div className={"k-asm"}>
        <div>
          <span>假设 1 · 每月缴存额（不是余额月增长）</span>
          <b>{data.contribLine}</b>
          <span className={"k-asmInline"}>{data.contribDetail}</span>
        </div>
        <div>
          <span>假设 2 · 利率（现行，按月复利）</span>
          <b>{data.rateLine}</b>
          <span className={"k-asmBlock"}>{data.rateExtra}</span>
        </div>
      </div>
      <ul>
        {data.bullets.map((b) => (
          <li key={b.slice(0, 24)}>{b}</li>
        ))}
      </ul>
      {data.byline ? <span className={"by"}>{data.byline}</span> : null}
    </div>
  );
}
