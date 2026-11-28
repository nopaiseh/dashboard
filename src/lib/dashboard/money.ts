/**
 * Cent-rounded money equality for server-side ledger / net checks.
 * Never log the compared values (may be sensitive).
 */

/** Compare two finite amounts after rounding to the nearest cent. */
export function amountsEqualInCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}
