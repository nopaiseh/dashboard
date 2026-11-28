/**
 * Dashboard section category helpers. Categories are plaintext on
 * dashboard_sections; always compare normalized (trim + lowercase).
 */

/** Trim + lowercase; empty input stays empty. */
export function normalizeDashboardCategory(category: string): string {
  return category.trim().toLowerCase();
}

/** Normalize a list of category labels for storage / comparison. */
export function normalizeDashboardCategories(
  categories: readonly string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of categories) {
    const n = normalizeDashboardCategory(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
