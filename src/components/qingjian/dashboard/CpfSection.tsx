import { CpfAccounts } from "./CpfAccounts";
import { CpfAnnual } from "./CpfAnnual";
import { CpfAssumptions } from "./CpfAssumptions";
import { CpfConclusion } from "./CpfConclusion";
import { CpfContrib } from "./CpfContrib";
import { CpfLedger } from "./CpfLedger";
import { CpfProgress } from "./CpfProgress";
import { CpfTodos } from "./CpfTodos";
import { StackedTrendChart } from "./StackedTrendChart";
import type { CpfViewModel } from "./cpfModel";
import type { ChartRangeMode } from "./types";

/**
 * C2 九段布局。金额只来自传入的 model（由 parseCpfModel 从 API 分区解析）。
 * 禁止在此文件 import 示例数据模块。
 */
export function CpfSection({
  model,
  sampleMode = false,
  trendRange,
}: {
  model: CpfViewModel;
  sampleMode?: boolean;
  trendRange?: ChartRangeMode;
}) {
  return (
    <div className={"k-cpf"}>
      <CpfConclusion
        title={model.conclusion?.title}
        body={model.conclusion?.body}
        sampleMode={sampleMode}
        reachedFrs={model.conclusion?.reachedFrs === true}
      />
      <CpfAccounts data={model.accounts} sampleMode={sampleMode} />
      <CpfProgress data={model.progress} sampleMode={sampleMode} />
      <StackedTrendChart
        data={model.trend}
        sampleMode={sampleMode}
        initialRange={trendRange ?? model.trend?.defaultRange}
        projection={{
          rates: model.annual?.rates,
          contrib: model.contrib
            ? {
                OA: model.contrib.OA,
                SA: model.contrib.SA,
                MA: model.contrib.MA,
              }
            : undefined,
          bhs: model.progress?.bhs,
          frs: model.progress?.frs,
        }}
      />
      <CpfContrib data={model.contrib} sampleMode={sampleMode} />
      <CpfAnnual data={model.annual} sampleMode={sampleMode} />
      <CpfTodos items={model.todos} sampleMode={sampleMode} />
      <CpfLedger
        rows={model.ledger}
        summary={model.ledgerSummary}
        emptyWithdrawals={model.ledgerEmptyWithdrawals}
        sampleMode={sampleMode}
      />
      <div className={"k-assumptionsWrap"}>
        <CpfAssumptions data={model.assumptions} />
      </div>
    </div>
  );
}
