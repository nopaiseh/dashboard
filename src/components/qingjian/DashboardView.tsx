import type { DashboardReadResult } from "@/lib/dashboard/types";
import { BlockRenderer } from "./dashboard/BlockRenderer";
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
  sampleBanner = false,
}: {
  data: DashboardReadResult;
  /** Mark story / fixture renders as 示例数据 (never for live owner data). */
  sampleBanner?: boolean;
}) {
  const sections = sortSectionsForView(data.sections);
  const empty = isDashboardEmpty(data.headline, data.sections);
  const headline = data.headline.trim();

  return (
    <div className={"qj-dash"}>
      {sampleBanner ? (
        <p className={"qj-dashSampleBanner"} role="note">
          示例数据 — 虚构数值，仅供版式预览
        </p>
      ) : null}

      {headline ? (
        <section className={"qj-hero qj-dashHeadline"} aria-labelledby="dash-headline">
          <h1 id="dash-headline">{headline}</h1>
        </section>
      ) : null}

      {empty ? (
        <div className={"qj-dashPageEmpty"} role="status">
          <p>{PAGE_EMPTY_TEXT}</p>
        </div>
      ) : (
        sections.map((section) => {
          const blocks = sortBlocksForView(section.blocks);
          if (blocks.length === 0) return null;
          const pinned = isPinnedCategory(section.category);
          return (
            <section
              key={section.id}
              className={
                pinned
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
