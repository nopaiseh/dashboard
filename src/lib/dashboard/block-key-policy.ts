/**
 * Category-scoped block_key whitelist.
 * - bank → BANK_BLOCK_KEYS only
 * - cpf → CPF_BLOCK_KEYS only
 * - other categories → status quo (CPF_BLOCK_KEYS if a key is present)
 */

import { BANK_BLOCK_KEYS, isBankBlockKey } from "@/lib/bank-block-keys";
import { CPF_BLOCK_KEYS } from "@/lib/cpf-block-keys";
import { normalizeDashboardCategory } from "@/lib/dashboard/category";

export type BlockKeyPolicyCategory = "bank" | "cpf" | "other";

export function blockKeyPolicyCategory(
  category: string,
): BlockKeyPolicyCategory {
  const n = normalizeDashboardCategory(category);
  if (n === "bank") return "bank";
  if (n === "cpf") return "cpf";
  return "other";
}

/** Allowed block_key values for a section category (when a key is supplied). */
export function allowedBlockKeysForCategory(
  category: string,
): readonly string[] {
  switch (blockKeyPolicyCategory(category)) {
    case "bank":
      return BANK_BLOCK_KEYS;
    case "cpf":
    case "other":
      return CPF_BLOCK_KEYS;
  }
}

/**
 * Validate optional block_key against the section category whitelist.
 * Returns false when the key is present but not allowed for that category.
 */
export function isBlockKeyAllowedForCategory(
  category: string,
  blockKey: string | undefined,
): boolean {
  if (blockKey === undefined) return true;
  const allowed = allowedBlockKeysForCategory(category);
  return (allowed as readonly string[]).includes(blockKey);
}

/** Cross-category misuse helpers for tests / clear 400 paths. */
export function isCpfBlockKey(key: string): boolean {
  return (CPF_BLOCK_KEYS as readonly string[]).includes(key);
}

export { isBankBlockKey };
