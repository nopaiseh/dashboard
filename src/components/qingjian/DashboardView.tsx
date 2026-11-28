import type { DashboardReadResult } from "@/lib/dashboard/types";
import { BlockRenderer } from "./dashboard/BlockRenderer";
import { CpfSection } from "./dashboard/CpfSection";
import { mergeSectionBlocks } from "./dashboard/boardSummary";
import { parseCpfModel } from "./dashboard/parseCpfModel";
import {
  PAGE_EMPTY_TEXT,
  categoryLabel,
  isPinnedCategory,
} from "./dashboard/labels";
import {
  isDashboardEmpty,
  sortBlocksForView,
  sortSectionsForView,
} from "./dashboard/sortSections";

export function DashboardView({
  data,
  sampleMode = false,
}: {
  data: DashboardReadResult;
  /** 仅截图 / 故事夹具为 true；生产页永不传。只控制横幅/chip，不注入示例金额。 */
  sampleMode?: boolean;
}) {
  const sections = sortSectionsForView(data.sections);
  const empty = isDashboardEmpty(data.headline, data.sections);
  const cpfSections = sections.filter((s) => isPinnedCategory(s.category));
  const otherSections = sections.filter((s) => !isPinnedCategory(s.category));
  // Merge all CPF partitions so cpf_conclusion / keyed blocks are visible across agents.
  const mergedCpf = mergeSectionBlocks(cpfSections);

  return (
    <div className={"qj-dash"}>
      {sampleMode ? (
        <div className={"banner"} role="note">
          <b>示例数据</b>
          此页所有数字、日期均为设计稿占位，不是真实数据。
        </div>
      ) : null}

      {empty ? (
        <div className={"qj-dashPageEmpty"} role="status">
          <p>{PAGE_EMPTY_TEXT}</p>
        </div>
      ) : (
        <>
          {mergedCpf ? (
            <CpfSection
              key={mergedCpf.id}
              model={parseCpfModel(mergedCpf, data.headline)}
              sampleMode={sampleMode}
            />
          ) : null}
          {otherSections.map((section) => {
            const blocks = sortBlocksForView(section.blocks);
            if (blocks.length === 0) return null;
            return (
              <section
                key={section.id}
                className={"qj-dashSection"}
                aria-labelledby={`dash-sec-${section.id}`}
              >
                <header className={"qj-sectionHead qj-dashSectionHead"}>
                  <h2 id={`dash-sec-${section.id}`}>
                    {categoryLabel(section.category)}
                  </h2>
                </header>
                <div className={"qj-dashBlocks"}>
                  {blocks.map((block) => (
                    <BlockRenderer key={block.id} block={block} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
