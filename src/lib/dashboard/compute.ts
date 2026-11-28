/**
 * Server-side derived-value hook for dashboard blocks.
 *
 * Decrypts the block payload in memory, runs `compute`, and returns the
 * result. Does not store, cache, or log plaintext (or derived values that
 * embed secrets). CPF target-date projection will plug in later — math is
 * out of scope here.
 */

import { decryptBlockPayloadStrict } from "@/lib/dashboard/crypto";

export interface DashboardDerivedComputer<
  TPayload extends object,
  TResult,
> {
  /** Stable name for diagnostics (never include payload). */
  readonly name: string;
  compute(payload: TPayload): TResult;
}

/**
 * Decrypt → compute → return. Callers must not log `TResult` if it embeds
 * sensitive fields from the payload.
 */
export function runDerivedCompute<TPayload extends object, TResult>(
  block: { id: string; payload: string },
  computer: DashboardDerivedComputer<TPayload, TResult>,
): TResult {
  const payload = decryptBlockPayloadStrict(block) as TPayload;
  return computer.compute(payload);
}
