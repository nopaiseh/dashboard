/**
 * Server-side helpers for encrypted-payload `block_key` uniqueness.
 * Never log decrypted payloads.
 */

import { decryptBlockPayload } from "@/lib/dashboard/crypto";
import type { BankBlockKey } from "@/lib/bank-block-keys";
import type { CpfBlockKey } from "@/lib/cpf-block-keys";

/** Travel keys include trip-scoped forms; stored as plain strings. */
export type DashboardBlockKey = CpfBlockKey | BankBlockKey | string;

/**
 * Read a validated payload's optional block_key.
 * Call only after zod / parseDashboardBlockPayload has accepted the payload.
 */
export function readPayloadBlockKey(
  payload: Record<string, unknown>,
): DashboardBlockKey | undefined {
  const key = payload.block_key;
  return typeof key === "string" ? (key as DashboardBlockKey) : undefined;
}

/**
 * True when another block in the same section already carries `blockKey`.
 *
 * Prefer the plaintext `block_key` column + unique index when available
 * (upsert path). This decrypt-based check remains for POST/PATCH until all
 * writers populate the column.
 *
 * Decrypts sibling payloads in memory; never logs them.
 */
export function sectionHasBlockKeyConflict(
  sectionBlocks: ReadonlyArray<{
    id: string;
    payload: string;
    block_key?: string | null;
  }>,
  blockKey: string,
  excludeBlockId?: string,
): boolean {
  for (const row of sectionBlocks) {
    if (excludeBlockId !== undefined && row.id === excludeBlockId) {
      continue;
    }
    if (row.block_key != null && row.block_key === blockKey) {
      return true;
    }
    const { payload, decrypt_failed } = decryptBlockPayload(row);
    if (decrypt_failed) {
      continue;
    }
    if (payload.block_key === blockKey) {
      return true;
    }
  }
  return false;
}

/**
 * Among rows with NULL plaintext `block_key`, find ids whose decrypted
 * payload carries `blockKey`. Decrypt failures are skipped (never logged).
 */
export function collectLegacyBlockKeyMatches(
  nullKeyBlocks: ReadonlyArray<{ id: string; payload: string }>,
  blockKey: string,
): string[] {
  const matches: string[] = [];
  for (const row of nullKeyBlocks) {
    const { payload, decrypt_failed } = decryptBlockPayload(row);
    if (decrypt_failed) {
      continue;
    }
    if (payload.block_key === blockKey) {
      matches.push(row.id);
    }
  }
  return matches;
}
