/**
 * Singapore NRIC / FIN (CPF account number equals NRIC).
 * Word-boundary aware so currency like "S$1234" and bare years are not matched.
 * Never log a matched value — callers must only log a generic reason.
 */
const SINGAPORE_NRIC_OR_FIN = /\b[STFGM]\d{7}[A-Z]\b/i;

/**
 * Forbidden identifier key names (case-insensitive; camelCase / snake_case
 * normalized by stripping non-alphanumerics).
 * Covers: nric, fin, cpf_account, account_no, cpfAccount, accountNo,
 * cpf_account_no, etc.
 */
const FORBIDDEN_IDENTIFIER_KEYS = new Set([
  "nric",
  "fin",
  "cpfaccount",
  "accountno",
  "cpfaccountno",
]);

/** Normalize object keys for forbidden-name comparison. */
export function normalizeDashboardIdentifierKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isForbiddenDashboardIdentifierKey(key: string): boolean {
  return FORBIDDEN_IDENTIFIER_KEYS.has(normalizeDashboardIdentifierKey(key));
}

export function stringContainsSingaporeNricOrFin(value: string): boolean {
  return SINGAPORE_NRIC_OR_FIN.test(value);
}

/**
 * Two-layer NRIC / CPF-account blocking:
 * (a) reject forbidden object keys at any depth (nric, fin, cpf_account, …)
 * (b) regex-scan all string values (titles, body, list items, labels, …)
 *
 * Also rejects keys whose *name* itself matches the NRIC/FIN pattern.
 */
export function containsSingaporeNricOrFin(value: unknown): boolean {
  const seen = new WeakSet<object>();

  function walk(node: unknown): boolean {
    if (typeof node === "string") {
      return stringContainsSingaporeNricOrFin(node);
    }
    if (node === null || typeof node !== "object") {
      return false;
    }
    if (seen.has(node)) {
      return false;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        if (walk(item)) return true;
      }
      return false;
    }

    for (const [key, child] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (isForbiddenDashboardIdentifierKey(key)) return true;
      if (stringContainsSingaporeNricOrFin(key)) return true;
      if (walk(child)) return true;
    }
    return false;
  }

  return walk(value);
}
