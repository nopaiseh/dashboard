/**
 * Singapore NRIC / FIN (CPF account number equals NRIC) + shared dashboard
 * privacy scans (card / passport / booking-keyword). Never log a matched
 * value or parsed embedded JSON.
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
 * Passport scan strips hyphens / dots / etc. but NOT spaces — so
 * `Salary 2026-11-29` does not fuse into letter+digit runs.
 */
const PASSPORT_SCAN_SEPARATORS = /[\-._,/\\]+/g;

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
 * Passport-like: letter + 7–9 digits + mandatory trailing letter.
 * Spaces are not joined (see PASSPORT_SCAN_SEPARATORS).
 */
const PASSPORT_LIKE = /[A-Z]\d{7,9}[A-Z]/i;

/**
 * Card number with space or hyphen separators (13–19 digits total), e.g.
 * `4111 1111 1111 1111` / `4111-1111-1111-1111`. Raw 9+ digit runs are
 * already covered by LONG_DIGIT_RUN.
 */
const SEPARATED_CARD_CHUNK = /\d(?:[\s\-]*\d){12,18}/g;

/**
 * Booking/ref keyword immediately followed by a 5–8 char alphanumeric token
 * (capture group 1). Case-insensitive; optional colon / space / # / fullwidth
 * colon between. Pure YYYYMMDD date-like tokens are excluded in
 * {@link stringContainsBookingKeywordRef} (e.g. `ref 20270110` is allowed).
 */
const BOOKING_KEYWORD_REF =
  /(?:\b(?:PNR|booking|ref|reference|confirmation)\b|订单号|确认码|预订号|订单)\s*[:#：]?\s*([A-Za-z0-9]{5,8})\b/gi;

/** True when token is a calendar YYYYMMDD (used to exempt date notes after keywords). */
function isYyyymmddDateLikeToken(token: string): boolean {
  if (!/^\d{8}$/.test(token)) return false;
  const y = Number(token.slice(0, 4));
  const m = Number(token.slice(4, 6));
  const d = Number(token.slice(6, 8));
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) {
    return false;
  }
  const iso = `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === iso;
}

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

export type PrivacyScanOptions = {
  /**
   * When true, also reject entire-value booking-ref shapes (uppercase /
   * lowercase / all-letter codes). Use only for travel category writes —
   * labels like `OCBC360` / `GIRO2026` are legitimate in cpf/bank.
   */
  travel?: boolean;
};

/** Build privacy options from a dashboard section category. */
export function privacyOptionsForCategory(
  category: string,
): PrivacyScanOptions {
  return {
    travel: category.trim().toLowerCase() === "travel",
  };
}

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

/** Strip hyphen / dot / etc. but keep spaces (passport scan). */
export function normalizeForPassportScan(value: string): string {
  return value.replace(PASSPORT_SCAN_SEPARATORS, "");
}

export function stringContainsSingaporeNricOrFin(value: string): boolean {
  return SINGAPORE_NRIC_OR_FIN.test(normalizeForNricScan(value));
}

/** True when the string contains 9+ consecutive digits (raw, no separator strip). */
export function stringContainsLongDigitRun(value: string): boolean {
  return LONG_DIGIT_RUN.test(value);
}

/** Passport-like (mandatory check letter; spaces not joined). Never log the match. */
export function stringContainsPassportLike(value: string): boolean {
  return PASSPORT_LIKE.test(normalizeForPassportScan(value));
}

/** 13–19 digits with space/hyphen separators (card-like). Never log the match. */
export function stringContainsSeparatedCardNumber(value: string): boolean {
  SEPARATED_CARD_CHUNK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SEPARATED_CARD_CHUNK.exec(value)) !== null) {
    const digits = match[0]!.replace(/[\s\-]/g, "");
    if (digits.length >= 13 && digits.length <= 19) {
      return true;
    }
  }
  return false;
}

/**
 * Keyword + nearby alphanumeric token (PNR / 订单号 / …). Never log the match.
 * Pure 8-digit YYYYMMDD tokens after the keyword are not treated as refs
 * (`ref 20270110` allowed; `ref ABC12X` / invalid `ref 12345678` still hit).
 */
export function stringContainsBookingKeywordRef(value: string): boolean {
  BOOKING_KEYWORD_REF.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BOOKING_KEYWORD_REF.exec(value)) !== null) {
    const token = match[1]!;
    if (isYyyymmddDateLikeToken(token)) continue;
    return true;
  }
  return false;
}

/** Flight/train-style service numbers (e.g. SQ321, AF1234) — not booking refs. */
const SERVICE_NUMBER_SHAPE = /^[A-Z]{2}\d{1,4}[A-Z]?$/i;

/**
 * Entire trimmed value looks like a full booking / confirmation code.
 * Travel-only. Rejects:
 * - mixed letter+digit codes (any case), length 6–14
 * - classic all-uppercase letter PNRs (exactly 6 letters)
 * Does not reject ordinary words (`travel`, `flight`) or mixed-case notes
 * like `1x32kg`. Short service numbers and `ref_tail` (≤2) are excluded.
 */
export function stringIsFullBookingRef(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 14) return false;
  if (!/^[A-Za-z0-9]+$/.test(trimmed)) return false;
  if (SERVICE_NUMBER_SHAPE.test(trimmed)) return false;
  if (SERVICE_NUMBER_SHAPE.test(trimmed.toUpperCase())) return false;
  // Classic all-letter PNR: exactly 6 uppercase letters.
  if (/^[A-Z]+$/.test(trimmed)) {
    return trimmed.length === 6;
  }
  // Lowercase or mixed-case all-letter words are ordinary language — skip.
  if (/^[A-Za-z]+$/.test(trimmed)) {
    return false;
  }
  // Mixed letter+digit codes:
  // - all-uppercase (ABC12X) → reject
  // - all-lowercase starting with a letter (abc12x) → reject (obfuscated PNR)
  // - mixed case or digit-leading notes (1x32kg) → allow
  if (/[A-Za-z]/.test(trimmed) && /\d/.test(trimmed)) {
    if (trimmed === trimmed.toUpperCase()) return true;
    if (trimmed === trimmed.toLowerCase() && /^[a-z]/.test(trimmed)) {
      return true;
    }
    return false;
  }
  return false;
}

export function looksLikeUuidString(value: string): boolean {
  return UUID_STRING.test(value.trim());
}

/**
 * Privacy hit for a single string. Error responses must not echo the match.
 * `travel: true` enables entire-value booking-ref rejection.
 * UUID-shaped strings are exempt from digit-run / separated-card checks.
 */
export function stringContainsBlockedIdentifier(
  value: string,
  options?: PrivacyScanOptions,
): boolean {
  if (stringContainsSingaporeNricOrFin(value)) return true;
  if (stringContainsPassportLike(value)) return true;
  if (stringContainsBookingKeywordRef(value)) return true;
  if (options?.travel && stringIsFullBookingRef(value)) return true;
  if (looksLikeUuidString(value)) return false;
  if (stringContainsSeparatedCardNumber(value)) return true;
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
 * (a) reject forbidden object keys at any depth
 * (b) regex-scan string values for NRIC/FIN, passport-like (no space-join;
 *     trailing letter required), separated card numbers, booking-keyword
 *     refs, and 9+ consecutive digits
 * (c) when `options.travel`, also reject entire-value booking-ref shapes
 *
 * Also rejects keys whose *name* itself matches blocked identifier patterns.
 *
 * String values that look like JSON (trimmed `{` / `[`) are JSON.parse'd and
 * walked recursively. Depth / size over the caps → fail closed. Never log
 * parsed content.
 *
 * Safe for existing CPF/bank fixtures: date phrases like `Salary 2026-11-29`
 * and labels like `OCBC360` / `GIRO2026` are not treated as passport / booking refs.
 */
export function containsSingaporeNricOrFin(
  value: unknown,
  options?: PrivacyScanOptions,
): boolean {
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
      return stringContainsBlockedIdentifier(node, options);
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
      if (stringContainsBlockedIdentifier(key, options)) return true;
      if (walk(child, jsonDepth, childMaxJsonLength)) return true;
    }
    return false;
  }

  return walk(value, 0, MAX_EMBEDDED_JSON_STRING_LENGTH);
}
