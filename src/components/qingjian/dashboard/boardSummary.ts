import type {
  DashboardBlockPublic,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";
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

/** Normalize category for grouping / matching. Do not decodeURIComponent — Next already decoded route params. */
export function normalizeCategory(category: string): string {
  return category.trim().toLowerCase();
}

/**
 * One-line board summary from title/conclusion blocks.
 * Prefers `cpf_conclusion` / `bank_conclusion` by block_key; then headline;
 * then text title/body; then list title.
 */
export function conclusionSummaryFromBlocks(
  blocks: DashboardBlockPublic[],
): string | null {
  const keyed = blocks.find((b) => {
    const key = str(b.payload.block_key)?.trim();
    return key === "cpf_conclusion" || key === "bank_conclusion";
  });
  if (keyed) {
    const title = str(keyed.payload.title)?.trim();
    const text = str(keyed.payload.text)?.trim();
    if (title) return firstLine(title);
    if (text) return firstLine(text);
  }

  const headlines = blocks
    .filter((b) => b.block_type === "headline")
    .sort((a, b) => a.sort_order - b.sort_order);
  for (const h of headlines) {
    const text = str(h.payload.text)?.trim();
    if (text) return firstLine(text);
  }

  const texts = blocks
    .filter((b) => b.block_type === "text")
    .sort((a, b) => a.sort_order - b.sort_order);
  for (const t of texts) {
    const title = str(t.payload.title)?.trim();
    if (title) return firstLine(title);
    const text = str(t.payload.text)?.trim();
    if (text) return firstLine(text);
  }

  const lists = blocks
    .filter((b) => b.block_type === "list")
    .sort((a, b) => a.sort_order - b.sort_order);
  for (const l of lists) {
    const title = str(l.payload.title)?.trim();
    if (title) return firstLine(title);
  }

  return null;
}

export function boardConclusionSummary(
  section: DashboardSectionPublic,
): string | null {
  return conclusionSummaryFromBlocks(section.blocks);
}

/** Summary across a category group (e.g. several agents' CPF sections). */
export function boardConclusionSummaryFromSections(
  sections: DashboardSectionPublic[],
): string | null {
  return conclusionSummaryFromBlocks(sections.flatMap((s) => s.blocks));
}

/** Latest of section.updated_at and any block updated_at. */
export function boardLastUpdatedIso(section: DashboardSectionPublic): string {
  let latest = section.updated_at;
  for (const b of section.blocks) {
    if (b.updated_at > latest) latest = b.updated_at;
  }
  return latest;
}

export function boardLastUpdatedIsoFromSections(
  sections: DashboardSectionPublic[],
): string {
  let latest = "";
  for (const s of sections) {
    const iso = boardLastUpdatedIso(s);
    if (iso > latest) latest = iso;
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

/** Headline text from matched sections only (not the global dashboard headline). */
export function sectionsHeadline(sections: DashboardSectionPublic[]): string {
  const headlines = sections
    .flatMap((s) => s.blocks)
    .filter((b) => b.block_type === "headline")
    .sort((a, b) => a.sort_order - b.sort_order);
  const text = headlines[0]?.payload.text;
  return typeof text === "string" ? text : "";
}

/**
 * Merge same-category (or CPF-pinned) sections so parseCpfModel can see
 * `cpf_conclusion` and other keyed blocks across agent partitions.
 */
export function mergeSectionBlocks(
  sections: DashboardSectionPublic[],
): DashboardSectionPublic | null {
  if (sections.length === 0) return null;
  const first = sections[0]!;
  return {
    ...first,
    blocks: sections.flatMap((s) => s.blocks),
  };
}

export type BoardCardModel = {
  /** Normalized category slug (unique card key). */
  category: string;
  href: string;
  name: string;
  summary: string;
  updatedLabel: string;
  updatedIso: string;
};

/** Group sections by normalized category; order follows sortSectionsForView. */
export function groupSectionsByCategory(
  sections: DashboardSectionPublic[],
): Array<{ category: string; sections: DashboardSectionPublic[] }> {
  const ordered = sortSectionsForView(sections);
  const groups = new Map<string, DashboardSectionPublic[]>();
  const order: string[] = [];
  for (const section of ordered) {
    const key = normalizeCategory(section.category);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.push(section);
    } else {
      groups.set(key, [section]);
      order.push(key);
    }
  }
  return order.map((category) => ({
    category,
    sections: groups.get(category)!,
  }));
}

export function buildBoardCards(
  sections: DashboardSectionPublic[],
  now: Date = new Date(),
): BoardCardModel[] {
  return groupSectionsByCategory(sections).map(({ category, sections: group }) => {
    const updatedIso = boardLastUpdatedIsoFromSections(group);
    const updatedLabel = formatBoardUpdated(updatedIso, now);
    const conclusion = boardConclusionSummaryFromSections(group);
    const labelSource = group[0]?.category ?? category;
    return {
      category,
      href: `/dashboard/${encodeURIComponent(category)}`,
      name: categoryLabel(labelSource),
      summary: conclusion ?? updatedLabel,
      updatedLabel,
      updatedIso,
    };
  });
}

/** All sections whose category matches (case-insensitive, trimmed). No URI decoding. */
export function findSectionsByCategory(
  sections: DashboardSectionPublic[],
  categoryParam: string,
): DashboardSectionPublic[] {
  const needle = normalizeCategory(categoryParam);
  if (!needle) return [];
  return sections.filter(
    (s) => normalizeCategory(s.category) === needle,
  );
}
