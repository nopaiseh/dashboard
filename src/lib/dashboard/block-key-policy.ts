/**
 * Category-scoped block_key whitelist.
 * - bank → BANK_BLOCK_KEYS only
 * - cpf → CPF_BLOCK_KEYS only
 * - travel → travel_<slot> or travel_<trip>_<slot>
 * - other categories → status quo (CPF_BLOCK_KEYS if a key is present)
 */

import { BANK_BLOCK_KEYS, isBankBlockKey } from "@/lib/bank-block-keys";
import { CPF_BLOCK_KEYS } from "@/lib/cpf-block-keys";
import { normalizeDashboardCategory } from "@/lib/dashboard/category";
import {
  isTravelBlockKey,
  TRAVEL_BLOCK_KEYS,
} from "@/lib/travel-block-keys";

export type BlockKeyPolicyCategory = "bank" | "cpf" | "travel" | "other";

export function blockKeyPolicyCategory(
  category: string,
): BlockKeyPolicyCategory {
  const n = normalizeDashboardCategory(category);
  if (n === "bank") return "bank";
  if (n === "cpf") return "cpf";
  if (n === "travel") return "travel";
  return "other";
}

/** Allowed block_key values for a section category (when a key is supplied). */
export function allowedBlockKeysForCategory(
  category: string,
): readonly string[] {
  switch (blockKeyPolicyCategory(category)) {
    case "bank":
      return BANK_BLOCK_KEYS;
    case "travel":
      return TRAVEL_BLOCK_KEYS;
    case "cpf":
    case "other":
      return CPF_BLOCK_KEYS;
  }
}

/**
 * Validate optional block_key against the section category whitelist.
 * Returns false when the key is present but not allowed for that category.
 * Travel accepts base keys and trip-scoped keys (`travel_<trip>_<slot>`).
 */
export function isBlockKeyAllowedForCategory(
  category: string,
  blockKey: string | undefined,
): boolean {
  if (blockKey === undefined) return true;
  if (blockKeyPolicyCategory(category) === "travel") {
    return isTravelBlockKey(blockKey);
  }
  const allowed = allowedBlockKeysForCategory(category);
  return (allowed as readonly string[]).includes(blockKey);
}

/** Cross-category misuse helpers for tests / clear 400 paths. */
export function isCpfBlockKey(key: string): boolean {
  return (CPF_BLOCK_KEYS as readonly string[]).includes(key);
}

export { isBankBlockKey, isTravelBlockKey };
