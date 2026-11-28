/**
 * Dashboard section category helpers (normalize + token allow-list checks).
 * Categories are plaintext on dashboard_sections; always compare normalized.
 */

export {
  SENSITIVE_DASHBOARD_CATEGORIES,
  isSensitiveDashboardCategory,
  sensitiveCategoriesIn,
} from "@/lib/dashboard/sensitive-categories";

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

/**
 * True when the token may write the given section category.
 * Empty `allowedCategories` → no writes (fail closed; migration backfill default).
 */
export function isCategoryAllowedForToken(
  allowedCategories: readonly string[],
  category: string,
): boolean {
  if (allowedCategories.length === 0) return false;
  const needle = normalizeDashboardCategory(category);
  if (!needle) return false;
  return allowedCategories.some(
    (c) => normalizeDashboardCategory(c) === needle,
  );
}
