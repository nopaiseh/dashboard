/**
 * Singapore NRIC / FIN (CPF account number equals NRIC).
 * Never log a matched value or parsed embedded JSON.
 */

/** Match after separator normalization (no word-boundary — separators already stripped). */
const SINGAPORE_NRIC_OR_FIN = /[STFGM]\d{7}[A-Z]/i;

/**
 * Separators removed before the NRIC regex so values like `S-1234567-A`,
 * `S 1234567 A`, and `S,1234567,A` still match. `$` is intentionally kept
 * so `S$1234` is not treated as an identifier.
 */
const NRIC_SCAN_SEPARATORS = /[\s\-._,/\\]+/g;

/**
 * Forbidden identifier key names (case-insensitive; camelCase / snake_case
 * normalized by stripping non-alphanumerics). Exact match after normalize —
 * so `final` / `fine` are not caught by `fin`.
 * Covers: nric, fin, cpf_account, account_no, cpfAccount, accountNo,
 * cpf_account_no, account_number, nric_number, etc.
 */
const FORBIDDEN_IDENTIFIER_KEYS = new Set([
  "nric",
  "fin",
  "cpfaccount",
  "accountno",
  "cpfaccountno",
  "accountnumber",
  "nricnumber",
]);

/** Max times we unwrap JSON-looking string values (DoS guard). */
export const MAX_EMBEDDED_JSON_DEPTH = 5;

/**
 * Reject JSON-looking strings longer than this (DoS guard; fail closed).
 * Aligned with BODY_MAX.
 */
export const MAX_EMBEDDED_JSON_STRING_LENGTH = 10_000;

/** Normalize object keys for forbidden-name comparison. */
export function normalizeDashboardIdentifierKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isForbiddenDashboardIdentifierKey(key: string): boolean {
  return FORBIDDEN_IDENTIFIER_KEYS.has(normalizeDashboardIdentifierKey(key));
}

/** Strip whitespace / hyphen / dot / underscore / comma / slash before NRIC scan. */
export function normalizeForNricScan(value: string): string {
  return value.replace(NRIC_SCAN_SEPARATORS, "");
}

export function stringContainsSingaporeNricOrFin(value: string): boolean {
  return SINGAPORE_NRIC_OR_FIN.test(normalizeForNricScan(value));
}

/** True when trimmed value starts with `{` or `[` (JSON object/array shape). */
export function looksLikeJsonContainer(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed[0];
  return first === "{" || first === "[";
}

/**
 * Two-layer NRIC / CPF-account blocking:
 * (a) reject forbidden object keys at any depth (nric, fin, cpf_account, …)
 * (b) regex-scan all string values after separator normalization
 *
 * Also rejects keys whose *name* itself matches the NRIC/FIN pattern.
 *
 * String values that look like JSON (trimmed `{` / `[`) are JSON.parse'd and
 * walked recursively so banned keys inside list-item JSON strings are caught.
 * Depth / size over the caps → fail closed (treat as hit). Parse failure →
 * regex-only scan. Never log parsed content.
 */
export function containsSingaporeNricOrFin(value: unknown): boolean {
  const seen = new WeakSet<object>();

  function walk(node: unknown, jsonDepth: number): boolean {
    if (typeof node === "string") {
      if (looksLikeJsonContainer(node)) {
        const trimmed = node.trim();
        // Fail closed: do not silently skip deeper checks past caps.
        if (jsonDepth >= MAX_EMBEDDED_JSON_DEPTH) {
          return true;
        }
        if (trimmed.length > MAX_EMBEDDED_JSON_STRING_LENGTH) {
          return true;
        }
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (walk(parsed, jsonDepth + 1)) {
            return true;
          }
        } catch {
          // Parse failed — fall back to regex-only on the raw string.
        }
      }
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
        if (walk(item, jsonDepth)) return true;
      }
      return false;
    }

    for (const [key, child] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (isForbiddenDashboardIdentifierKey(key)) return true;
      if (stringContainsSingaporeNricOrFin(key)) return true;
      if (walk(child, jsonDepth)) return true;
    }
    return false;
  }

  return walk(value, 0);
}
