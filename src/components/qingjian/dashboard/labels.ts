/** Category display labels; unknown categories fall back to raw slug. */
const CATEGORY_LABELS: Record<string, string> = {
  cpf: "公积金",
  travel: "旅行",
  home: "家居",
};

export const PINNED_CATEGORY = "cpf";

export const PROJECTION_NOTE = "按现行利率计息，未计入利率调整";

export const PAGE_EMPTY_TEXT = "暂无看板内容。专员写入分区后，会显示在这里。";

export const BLOCK_EMPTY_DEFAULT = "暂无数据";

export function categoryLabel(category: string): string {
  const key = category.trim().toLowerCase();
  return CATEGORY_LABELS[key] ?? category;
}

export function isPinnedCategory(category: string): boolean {
  return category.trim().toLowerCase() === PINNED_CATEGORY;
}

export function chartEventLabel(kind: string, fallback?: string): string {
  if (fallback?.trim()) return fallback.trim();
  if (kind === "employer_change") return "换雇主";
  if (kind === "lump_sum") return "一次性转入";
  return "标注";
}
