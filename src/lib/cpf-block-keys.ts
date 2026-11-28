/**
 * Whitelisted `block_key` values for encrypted dashboard block payloads.
 * Shared by API validation and the frontend CPF view model.
 * Keys are semantic slot names only — never personal identifiers.
 */
export const CPF_BLOCK_KEYS = [
  "cpf_conclusion",
  "cpf_acc_oa",
  "cpf_acc_sa",
  "cpf_acc_ma",
  "cpf_prog_ma",
  "cpf_prog_oasa",
  "cpf_trend_oa",
  "cpf_trend_sa",
  "cpf_trend_ma",
  "cpf_contrib",
  "cpf_int_oa",
  "cpf_int_sa",
  "cpf_int_ma",
  "cpf_int_total",
  "cpf_rstu",
  "cpf_rstu_paid",
  "cpf_todos",
  "cpf_ledger",
  "cpf_assumptions",
] as const;

export type CpfBlockKey = (typeof CPF_BLOCK_KEYS)[number];
