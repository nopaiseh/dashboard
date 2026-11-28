import type { DashboardSectionPublic } from "@/lib/dashboard/types";
import { formatShortDate } from "@/lib/ui/format";
import { categoryLabel } from "./labels";
import { sortSectionsForView } from "./sortSections";

export const OVERVIEW_EMPTY_TITLE = "还没有看板";
export const OVERVIEW_EMPTY_HINT = "专员创建分区后，会以卡片形式显示在这里。";
export const OVERVIEW_PAGE_TITLE = "全部看板";
export const OVERVIEW_BACK_LABEL = "← 全部看板";

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function firstLine(text: string): string {
  return text.split(/\n+/)[0]?.trim() ?? "";
}

/**
 * One-line board summary from title/conclusion blocks.
 * Prefers `cpf_conclusion` by block_key; then headline; then text title/body.
 * Returns null when none — callers fall back to last-updated copy.
 */
export function boardConclusionSummary(
  section: DashboardSectionPublic,
): string | null {
  const keyed = section.blocks.find(
    (b) => str(b.payload.block_key)?.trim() === "cpf_conclusion",
  );
  if (keyed) {
    const title = str(keyed.payload.title)?.trim();
    const text = str(keyed.payload.text)?.trim();
    if (title) return firstLine(title);
    if (text) return firstLine(text);
  }

  const headlines = section.blocks
    .filter((b) => b.block_type === "headline")
    .sort((a, b) => a.sort_order - b.sort_order);
  for (const h of headlines) {
    const text = str(h.payload.text)?.trim();
    if (text) return firstLine(text);
  }

  const texts = section.blocks
    .filter((b) => b.block_type === "text")
    .sort((a, b) => a.sort_order - b.sort_order);
  for (const t of texts) {
    const title = str(t.payload.title)?.trim();
    if (title) return firstLine(title);
    const text = str(t.payload.text)?.trim();
    if (text) return firstLine(text);
  }

  return null;
}

/** Latest of section.updated_at and any block updated_at. */
export function boardLastUpdatedIso(section: DashboardSectionPublic): string {
  let latest = section.updated_at;
  for (const b of section.blocks) {
    if (b.updated_at > latest) latest = b.updated_at;
  }
  return latest;
}

export function formatBoardUpdated(
  iso: string,
  now: Date = new Date(),
): string {
  const short = formatShortDate(iso, now);
  return short ? `更新于 ${short}` : "";
}

export type BoardCardModel = {
  category: string;
  href: string;
  name: string;
  summary: string;
  updatedLabel: string;
  updatedIso: string;
};

export function buildBoardCards(
  sections: DashboardSectionPublic[],
  now: Date = new Date(),
): BoardCardModel[] {
  return sortSectionsForView(sections).map((section) => {
    const category = section.category.trim().toLowerCase() || section.category;
    const updatedIso = boardLastUpdatedIso(section);
    const updatedLabel = formatBoardUpdated(updatedIso, now);
    const conclusion = boardConclusionSummary(section);
    return {
      category,
      href: `/dashboard/${encodeURIComponent(category)}`,
      name: categoryLabel(section.category),
      summary: conclusion ?? updatedLabel,
      updatedLabel,
      updatedIso,
    };
  });
}

export function findSectionByCategory(
  sections: DashboardSectionPublic[],
  categoryParam: string,
): DashboardSectionPublic | undefined {
  const needle = decodeURIComponent(categoryParam).trim().toLowerCase();
  if (!needle) return undefined;
  return sections.find((s) => s.category.trim().toLowerCase() === needle);
}
