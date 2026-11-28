/**
 * Server-side helpers for encrypted-payload `block_key` uniqueness.
 * Never log decrypted payloads.
 */

import { decryptBlockPayload } from "@/lib/dashboard/crypto";
import type { CpfBlockKey } from "@/lib/cpf-block-keys";

/**
 * Read a validated payload's optional block_key.
 * Call only after zod has accepted the payload for the block_type.
 */
export function readPayloadBlockKey(
  payload: Record<string, unknown>,
): CpfBlockKey | undefined {
  const key = payload.block_key;
  return typeof key === "string" ? (key as CpfBlockKey) : undefined;
}

/**
 * True when another block in the same section already carries `blockKey`.
 *
 * Race window: two concurrent writers can both pass this check before either
 * commits. Acceptable for a single-writer agent; no DB uniqueness constraint
 * (block_key lives only inside the encrypted payload).
 *
 * Decrypts sibling payloads in memory; never logs them.
 */
export function sectionHasBlockKeyConflict(
  sectionBlocks: ReadonlyArray<{ id: string; payload: string }>,
  blockKey: string,
  excludeBlockId?: string,
): boolean {
  for (const row of sectionBlocks) {
    if (excludeBlockId !== undefined && row.id === excludeBlockId) {
      continue;
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
