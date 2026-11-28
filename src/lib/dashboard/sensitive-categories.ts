/**
 * Sensitive dashboard categories: only one agent may hold them
 * (sections + active token allow-lists). Do not hardcode agent ids.
 */

export const SENSITIVE_DASHBOARD_CATEGORIES = ["cpf", "bank"] as const;

export type SensitiveDashboardCategory =
  (typeof SENSITIVE_DASHBOARD_CATEGORIES)[number];

function norm(category: string): string {
  return category.trim().toLowerCase();
}

export function isSensitiveDashboardCategory(
  category: string,
): category is SensitiveDashboardCategory {
  const n = norm(category);
  return (SENSITIVE_DASHBOARD_CATEGORIES as readonly string[]).includes(n);
}

/** Sensitive categories present in a (possibly unnormalized) list. */
export function sensitiveCategoriesIn(
  categories: readonly string[],
): SensitiveDashboardCategory[] {
  const out: SensitiveDashboardCategory[] = [];
  const seen = new Set<string>();
  for (const raw of categories) {
    const n = norm(raw);
    if (
      (SENSITIVE_DASHBOARD_CATEGORIES as readonly string[]).includes(n) &&
      !seen.has(n)
    ) {
      seen.add(n);
      out.push(n as SensitiveDashboardCategory);
    }
  }
  return out;
}
