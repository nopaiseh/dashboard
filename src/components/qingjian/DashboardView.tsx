import type { DashboardReadResult } from "@/lib/dashboard/types";
import { BlockRenderer } from "./dashboard/BlockRenderer";
import { CpfSection } from "./dashboard/CpfSection";
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
        sections.map((section) => {
          // 公积金分区一律走 C2 九段（#24 schema 无 role/c2_layout 字段）。
          if (isPinnedCategory(section.category)) {
            const model = parseCpfModel(section, data.headline);
            return (
              <CpfSection
                key={section.id}
                model={model}
                sampleMode={sampleMode}
              />
            );
          }

          const blocks = sortBlocksForView(section.blocks);
          if (blocks.length === 0) return null;
          return (
            <section
              key={section.id}
              className={
                isPinnedCategory(section.category)
                  ? "qj-dashSection qj-dashSectionPinned"
                  : "qj-dashSection"
              }
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
        })
      )}
    </div>
  );
}
