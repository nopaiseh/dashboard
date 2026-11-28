/**
 * Whitelisted `block_key` values for encrypted bank dashboard block payloads.
 * Shared by API validation (and later the frontend bank view model).
 * Keys are semantic slot names only — never personal identifiers or account numbers.
 *
 * FAKE: these are slot names for fixtures / agents; not real bank product codes tied
 * to any live account.
 */
export const BANK_BLOCK_KEYS = [
  "bank_conclusion",
  "bank_acc_ocbc_salary",
  "bank_acc_hsbc",
  "bank_acc_trust",
  "bank_acc_posb",
  "bank_acc_ocbc_savings",
  "bank_acc_gxs",
  "bank_acc_wise",
  "bank_prog_emergency",
  "bank_prog_gxs",
  "bank_prog_hub",
  "bank_prog_trust",
  "bank_prog_posb",
  "bank_prog_hsbc",
  "bank_prog_invest",
  "bank_liab",
  "bank_net",
  "bank_alloc",
  "bank_trend_ocbc_salary",
  "bank_trend_hsbc",
  "bank_trend_trust",
  "bank_trend_posb",
  "bank_trend_ocbc_savings",
  "bank_trend_gxs",
  "bank_trend_wise",
  "bank_ledger",
  "bank_todos",
  "bank_assumptions",
] as const;

export type BankBlockKey = (typeof BANK_BLOCK_KEYS)[number];

export const BANK_ACCOUNT_KEYS = [
  "ocbc_salary",
  "hsbc",
  "trust",
  "posb",
  "ocbc_savings",
  "gxs",
  "wise",
] as const;

export type BankAccountKey = (typeof BANK_ACCOUNT_KEYS)[number];

export const BANK_GROUPS = ["hub", "fixed", "daily", "savings", "fx"] as const;
export type BankGroup = (typeof BANK_GROUPS)[number];

/** True when `key` is a whitelisted bank block_key. */
export function isBankBlockKey(key: string): key is BankBlockKey {
  return (BANK_BLOCK_KEYS as readonly string[]).includes(key);
}
