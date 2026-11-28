import type { DashboardReadResult } from "@/lib/dashboard/types";
import { BlockRenderer } from "./dashboard/BlockRenderer";
import { CpfSection } from "./dashboard/CpfSection";
import { sectionUsesC2Layout } from "./dashboard/fixtures";
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
  /** 仅截图 / 故事夹具为 true；生产页永不传。 */
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
          if (
            isPinnedCategory(section.category) &&
            (sampleMode || sectionUsesC2Layout(section))
          ) {
            const c2 = section.blocks.find(
              (b) => b.payload.role === "c2_layout",
            );
            return (
              <CpfSection
                key={section.id}
                sampleMode={sampleMode}
                conclusionTitle={
                  (typeof c2?.payload.title === "string"
                    ? c2.payload.title
                    : data.headline) || undefined
                }
                conclusionBody={
                  typeof c2?.payload.text === "string"
                    ? c2.payload.text
                    : undefined
                }
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
