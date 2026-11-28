/**
 * Server-side exclusivity for sensitive dashboard categories (cpf / bank).
 * No agent ids are hardcoded — exclusivity is derived from existing rows.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeDashboardCategory,
  sensitiveCategoriesIn,
} from "@/lib/dashboard/category";
import { isSensitiveDashboardCategory } from "@/lib/dashboard/sensitive-categories";

export type SensitiveExclusivityResult =
  | { ok: true }
  | { ok: false; status: 409; error: string };

/**
 * Reject granting sensitive categories to `agentId` when:
 * - another agent's non-revoked token already lists that category, or
 * - a dashboard section with that category belongs to another agent.
 */
export async function assertSensitiveCategoriesGrantable(
  supabase: SupabaseClient,
  agentId: string,
  categories: readonly string[],
  options?: { excludeTokenId?: string },
): Promise<SensitiveExclusivityResult> {
  const sensitive = sensitiveCategoriesIn(categories);
  if (sensitive.length === 0) {
    return { ok: true };
  }

  const { data: tokens, error: tokensError } = await supabase
    .from("agent_tokens")
    .select("id, agent_id, allowed_categories, revoked_at")
    .is("revoked_at", null);

  if (tokensError) {
    return { ok: false, status: 409, error: "conflict" };
  }

  for (const cat of sensitive) {
    for (const row of tokens ?? []) {
      if (row.agent_id === agentId) continue;
      if (
        options?.excludeTokenId !== undefined &&
        row.id === options.excludeTokenId
      ) {
        continue;
      }
      const cats = Array.isArray(row.allowed_categories)
        ? (row.allowed_categories as string[])
        : [];
      if (
        cats.some((c) => normalizeDashboardCategory(c) === cat)
      ) {
        return { ok: false, status: 409, error: "conflict" };
      }
    }
  }

  const { data: sections, error: sectionsError } = await supabase
    .from("dashboard_sections")
    .select("id, agent_id, category");

  if (sectionsError) {
    return { ok: false, status: 409, error: "conflict" };
  }

  for (const cat of sensitive) {
    for (const row of sections ?? []) {
      if (row.agent_id == null || row.agent_id === agentId) continue;
      if (normalizeDashboardCategory(row.category) === cat) {
        return { ok: false, status: 409, error: "conflict" };
      }
    }
  }

  return { ok: true };
}

/**
 * Reject creating/renaming a section into a sensitive category when another
 * agent already owns a section with that category.
 */
export async function assertSensitiveSectionCreatable(
  supabase: SupabaseClient,
  agentId: string,
  category: string,
  options?: { excludeSectionId?: string },
): Promise<SensitiveExclusivityResult | { ok: false; status: 403; error: string }> {
  if (!isSensitiveDashboardCategory(category)) {
    return { ok: true };
  }
  const needle = normalizeDashboardCategory(category);

  const { data: sections, error } = await supabase
    .from("dashboard_sections")
    .select("id, agent_id, category");

  if (error) {
    return { ok: false, status: 403, error: "forbidden" };
  }

  for (const row of sections ?? []) {
    if (
      options?.excludeSectionId !== undefined &&
      row.id === options.excludeSectionId
    ) {
      continue;
    }
    if (row.agent_id == null || row.agent_id === agentId) continue;
    if (normalizeDashboardCategory(row.category) === needle) {
      return { ok: false, status: 403, error: "forbidden" };
    }
  }

  return { ok: true };
}
