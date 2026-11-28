import { C2_ASSUMPTIONS } from "./c2Data";

export function CpfAssumptions() {
  const a = C2_ASSUMPTIONS;
  return (
    <div className={"note"}>
      <h3>估算说明</h3>
      <div className={"k-asm"}>
        <div>
          <span>假设 1 · 每月缴存额（不是余额月增长）</span>
          <b>{a.contribLine}</b>
          <span className={"k-asmInline"}>{a.contribDetail}</span>
        </div>
        <div>
          <span>假设 2 · 利率（现行，按月复利）</span>
          <b>{a.rateLine}</b>
          <span className={"k-asmBlock"}>{a.rateExtra}</span>
        </div>
      </div>
      <ul>
        {a.bullets.map((b) => (
          <li key={b.slice(0, 24)}>{b}</li>
        ))}
      </ul>
      <span className={"by"}>{a.byline}</span>
    </div>
  );
}
