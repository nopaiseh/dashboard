/**
 * Singapore NRIC / FIN (CPF account number equals NRIC).
 * Never log a matched value or parsed embedded JSON.
 */

import { BANK_LEDGER_MONTH_JSON_MAX } from "@/lib/dashboard/bank-validation";

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
  // Bank / card / transfer identifiers (normalized: lowercase, strip non-alnum)
  "cardno",
  "cardnumber",
  "last4",
  "iban",
  "swift",
  "pan",
  // Travel / booking / credential identifiers
  "passport",
  "passportno",
  "passportnumber",
  "bookingref",
  "bookingreference",
  "confirmation",
  "confirmationcode",
  "confirmationnumber",
  "pnr",
  "password",
  "passwd",
  "ticketno",
  "ticketnumber",
  "eticket",
  "creditcard",
  "cvv",
  "cvc",
]);

/**
 * Nine or more consecutive ASCII digits in a string (account / card style).
 * Applied on the raw string only — do not strip separators (that would fuse
 * dates like 2026-01-01 into digit runs and false-positive CPF text).
 */
const LONG_DIGIT_RUN = /\d{9,}/;

/**
 * Passport-like: letter + 7–9 digits, optional trailing letter, after the
 * same separator strip as NRIC. Does not log the match.
 */
const PASSPORT_LIKE = /[A-Z]\d{7,9}[A-Z]?/i;

/** Request ids / section ids are UUIDs and must not trip the digit-run check. */
const UUID_STRING =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Max times we unwrap JSON-looking string values (DoS guard). */
export const MAX_EMBEDDED_JSON_DEPTH = 5;

/**
 * Reject JSON-looking strings longer than this (DoS guard; fail closed).
 * Aligned with BODY_MAX. bank_ledger month strings use
 * {@link MAX_BANK_LEDGER_EMBEDDED_JSON_STRING_LENGTH} instead.
 */
export const MAX_EMBEDDED_JSON_STRING_LENGTH = 10_000;

/**
 * Cap for bank_ledger month JSON strings (matches ledger schema month max).
 * Still runs the full NRIC / sensitive-pattern scan when under this cap.
 */
export const MAX_BANK_LEDGER_EMBEDDED_JSON_STRING_LENGTH =
  BANK_LEDGER_MONTH_JSON_MAX;

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

/** True when the string contains 9+ consecutive digits (raw, no separator strip). */
export function stringContainsLongDigitRun(value: string): boolean {
  return LONG_DIGIT_RUN.test(value);
}

/** Passport-like after separator normalization (never log the match). */
export function stringContainsPassportLike(value: string): boolean {
  return PASSPORT_LIKE.test(normalizeForNricScan(value));
}

/** Flight/train-style service numbers (e.g. SQ321, AF1234) — not booking refs. */
const SERVICE_NUMBER_SHAPE = /^[A-Z]{2}\d{1,4}[A-Z]?$/i;

/**
 * Entire trimmed value looks like a full booking / confirmation code.
 * Airline PNRs are uppercase alphanumeric; mixed-case notes like `1x32kg`
 * are not flagged. Short service numbers and `ref_tail` (≤2) are excluded.
 */
export function stringIsFullBookingRef(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 14) return false;
  // Canonical booking refs are uppercase A–Z / 0–9 only.
  if (!/^[A-Z0-9]+$/.test(trimmed)) return false;
  if (!/[A-Z]/.test(trimmed) || !/\d/.test(trimmed)) return false;
  if (SERVICE_NUMBER_SHAPE.test(trimmed)) return false;
  return true;
}

export function looksLikeUuidString(value: string): boolean {
  return UUID_STRING.test(value.trim());
}

/**
 * Privacy hit: NRIC/FIN, passport-like, full booking ref, and/or long digit run.
 * UUID-shaped strings are exempt from the digit-run check (section/block ids).
 * Error responses must not echo the matched substring.
 */
export function stringContainsBlockedIdentifier(value: string): boolean {
  if (stringContainsSingaporeNricOrFin(value)) return true;
  if (stringContainsPassportLike(value)) return true;
  if (stringIsFullBookingRef(value)) return true;
  if (looksLikeUuidString(value)) return false;
  return stringContainsLongDigitRun(value);
}

/** True when trimmed value starts with `{` or `[` (JSON object/array shape). */
export function looksLikeJsonContainer(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return false;
  const first = trimmed[0];
  return first === "{" || first === "[";
}

/**
 * Privacy blocking for dashboard writes (CPF + bank + travel):
 * (a) reject forbidden object keys at any depth (nric, fin, accountno, cardno,
 *     passport, bookingref, pnr, password, …)
 * (b) regex-scan all string values for NRIC/FIN / passport-like (after
 *     separator normalization), full booking-ref values, and 9+ consecutive
 *     digits (raw string; card-like)
 *
 * Also rejects keys whose *name* itself matches the NRIC/FIN pattern or a
 * long digit run.
 *
 * String values that look like JSON (trimmed `{` / `[`) are JSON.parse'd and
 * walked recursively so banned keys inside list-item JSON strings are caught.
 * Depth / size over the caps → fail closed (treat as hit). Parse failure →
 * regex-only scan. Never log parsed content.
 *
 * Safe for existing CPF fixtures: amounts stay numeric (not digit-scanned);
 * money within ±10_000_000 has ≤8 digits before the decimal.
 * Travel `ref_tail` (≤2) and short service numbers stay under booking-ref length.
 */
export function containsSingaporeNricOrFin(value: unknown): boolean {
  const seen = new WeakSet<object>();

  function walk(
    node: unknown,
    jsonDepth: number,
    maxJsonStringLength: number,
  ): boolean {
    if (typeof node === "string") {
      if (looksLikeJsonContainer(node)) {
        const trimmed = node.trim();
        // Fail closed: do not silently skip deeper checks past caps.
        if (jsonDepth >= MAX_EMBEDDED_JSON_DEPTH) {
          return true;
        }
        if (trimmed.length > maxJsonStringLength) {
          return true;
        }
        try {
          const parsed: unknown = JSON.parse(trimmed);
          if (walk(parsed, jsonDepth + 1, maxJsonStringLength)) {
            return true;
          }
        } catch {
          // Parse failed — fall back to regex-only on the raw string.
        }
      }
      return stringContainsBlockedIdentifier(node);
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
        if (walk(item, jsonDepth, maxJsonStringLength)) return true;
      }
      return false;
    }

    const record = node as Record<string, unknown>;
    // bank_ledger months are stored as large JSON strings; raise the unwrap
    // cap to the ledger schema limit while still scanning full content.
    const childMaxJsonLength =
      record.block_key === "bank_ledger"
        ? MAX_BANK_LEDGER_EMBEDDED_JSON_STRING_LENGTH
        : maxJsonStringLength;

    for (const [key, child] of Object.entries(record)) {
      if (isForbiddenDashboardIdentifierKey(key)) return true;
      if (stringContainsBlockedIdentifier(key)) return true;
      if (walk(child, jsonDepth, childMaxJsonLength)) return true;
    }
    return false;
  }

  return walk(value, 0, MAX_EMBEDDED_JSON_STRING_LENGTH);
}
