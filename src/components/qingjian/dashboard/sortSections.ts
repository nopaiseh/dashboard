import type { DashboardSectionPublic } from "@/lib/dashboard/types";
import { isPinnedCategory } from "./labels";

/**
 * CPF (`cpf`) sections always first (stable among themselves by sort_order),
 * then remaining sections by sort_order / created_at.
 */
export function sortSectionsForView(
  sections: DashboardSectionPublic[],
): DashboardSectionPublic[] {
  const pinned: DashboardSectionPublic[] = [];
  const rest: DashboardSectionPublic[] = [];
  for (const section of sections) {
    if (isPinnedCategory(section.category)) pinned.push(section);
    else rest.push(section);
  }
  const byOrder = (a: DashboardSectionPublic, b: DashboardSectionPublic) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at.localeCompare(b.created_at);
  };
  return [...pinned.sort(byOrder), ...rest.sort(byOrder)];
}

export function sortBlocksForView<
  T extends { sort_order: number; created_at: string; block_type: string },
>(blocks: T[]): T[] {
  return [...blocks]
    .filter((b) => b.block_type !== "headline")
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.created_at.localeCompare(b.created_at);
    });
}

export function isDashboardEmpty(
  headline: string,
  sections: DashboardSectionPublic[],
): boolean {
  if (headline.trim()) return false;
  return !sections.some((s) =>
    s.blocks.some((b) => b.block_type !== "headline"),
  );
}
