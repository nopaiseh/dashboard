import { CpfAccounts } from "./CpfAccounts";
import { CpfAnnual } from "./CpfAnnual";
import { CpfAssumptions } from "./CpfAssumptions";
import { CpfConclusion } from "./CpfConclusion";
import { CpfContrib } from "./CpfContrib";
import { CpfLedger } from "./CpfLedger";
import { CpfProgress } from "./CpfProgress";
import { CpfTodos } from "./CpfTodos";
import { StackedTrendChart } from "./StackedTrendChart";
import { C2_CONCLUSION } from "./c2Data";

/**
 * C2 定稿九段：结论 → 户口 → 进度 → 走势 → 缴存 → 年度 → 待办 → 流水 → 估算说明。
 * 示例数字来自 c2_model；生产页不显示「示例数据」chip / 横幅。
 */
export function CpfSection({
  sampleMode = false,
  conclusionTitle,
  conclusionBody,
  trendRange = "12m",
}: {
  sampleMode?: boolean;
  conclusionTitle?: string;
  conclusionBody?: string;
  /** 截图夹具：走势默认范围 */
  trendRange?: "12m" | "all";
}) {
  return (
    <div className={"k-cpf"}>
      <CpfConclusion
        title={conclusionTitle ?? C2_CONCLUSION.title}
        body={conclusionBody ?? C2_CONCLUSION.body}
        sampleMode={sampleMode}
        reachedFrs
      />
      <CpfAccounts sampleMode={sampleMode} />
      <CpfProgress sampleMode={sampleMode} />
      <StackedTrendChart sampleMode={sampleMode} initialRange={trendRange} />
      <CpfContrib sampleMode={sampleMode} />
      <CpfAnnual sampleMode={sampleMode} />
      <CpfTodos sampleMode={sampleMode} />
      <CpfLedger sampleMode={sampleMode} />
      <div className={"k-assumptionsWrap"}>
        <CpfAssumptions />
      </div>
    </div>
  );
}
