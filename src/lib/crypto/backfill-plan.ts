/**
 * Pure helpers for the encrypt-existing-fields backfill (testable without DB).
 */

import {
  computeContentHash,
  computeLegacyContentHash,
  type ContentHashFields,
} from "@/lib/content-hash";
import {
  decryptField,
  decryptNullableField,
  encryptField,
  isEncryptedEnvelope,
  type SensitiveColumn,
} from "@/lib/crypto/fields-core";

export type BackfillItemRow = {
  id: string;
  title: string;
  body: string;
  source_url: string | null;
  kind: string;
  options: unknown;
  due_at: string | null;
  content_hash: string;
};

export type BackfillPlan =
  | { action: "skip"; reason: "already_migrated" }
  | {
      action: "update";
      /** Values currently in DB (for CAS predicates). */
      expected: {
        title: string;
        body: string;
        source_url: string | null;
        content_hash: string;
      };
      /** New encrypted fields + HMAC content_hash. */
      patch: {
        title: string;
        body: string;
        source_url: string | null;
        content_hash: string;
      };
      /** Previous content_hash (legacy or HMAC) for rewriting item_events. */
      previousContentHash: string;
    };

function decryptColumn(
  itemId: string,
  column: SensitiveColumn,
  stored: string,
): string {
  return decryptField(stored, { itemId, column });
}

/**
 * Plan a single-item backfill: re-encrypt with AAD if needed, recompute HMAC hash.
 * Idempotent: if fields already decrypt under AAD and hash is already HMAC, skip.
 */
export function planItemBackfill(row: BackfillItemRow): BackfillPlan {
  const plainTitle = decryptColumn(row.id, "title", row.title);
  const plainBody = decryptColumn(row.id, "body", row.body);
  const plainSource =
    row.source_url === null
      ? null
      : decryptNullableField(row.source_url, {
          itemId: row.id,
          column: "source_url",
        });

  const hashFields: ContentHashFields = {
    kind: row.kind,
    title: plainTitle,
    body: plainBody,
    options: row.options,
    source_url: plainSource,
    due_at: row.due_at,
  };
  const hmacHash = computeContentHash(hashFields);

  const titleOk =
    isEncryptedEnvelope(row.title) &&
    decryptColumn(row.id, "title", row.title) === plainTitle;
  const bodyOk =
    isEncryptedEnvelope(row.body) &&
    decryptColumn(row.id, "body", row.body) === plainBody;
  // Verify AAD binding by ensuring encrypt→decrypt round-trip identity isn't enough;
  // if already envelope and decrypt with AAD succeeded above, it's AAD-bound (or
  // no-AAD fallback). Re-encrypt whenever any column is not an envelope OR hash
  // is not yet HMAC.
  let needsReencrypt = !isEncryptedEnvelope(row.title) || !isEncryptedEnvelope(row.body);
  if (
    row.source_url !== null &&
    !isEncryptedEnvelope(row.source_url)
  ) {
    needsReencrypt = true;
  }

  // If envelopes exist but were written without AAD, decrypt still works via
  // fallback; detect by trying to encrypt fresh and comparing is wasteful.
  // Instead: if hash already HMAC and all envelopes present, attempt a swap-style
  // check — decrypt with wrong column AAD should fail when AAD is bound.
  // Simpler rule from review: skip only when already encrypted AND hash is HMAC.
  const hashIsHmac = row.content_hash === hmacHash;
  const hashIsLegacy = row.content_hash === computeLegacyContentHash(hashFields);

  if (!needsReencrypt && hashIsHmac && titleOk && bodyOk) {
    // Confirm AAD is actually bound: wrong-column decrypt must fail for title.
    try {
      decryptField(row.title, { itemId: row.id, column: "body" });
      // Succeeded with wrong column → no AAD (or weak); re-encrypt.
      needsReencrypt = true;
    } catch {
      // Expected: AAD mismatch → already bound.
    }
  }

  if (!needsReencrypt && hashIsHmac) {
    return { action: "skip", reason: "already_migrated" };
  }

  // If somehow hash matches neither, still migrate using decrypted plaintext.
  void hashIsLegacy;

  const patch = {
    title: encryptField(plainTitle, { itemId: row.id, column: "title" }),
    body: encryptField(plainBody, { itemId: row.id, column: "body" }),
    source_url:
      plainSource === null
        ? null
        : encryptField(plainSource, { itemId: row.id, column: "source_url" }),
    content_hash: hmacHash,
  };

  return {
    action: "update",
    expected: {
      title: row.title,
      body: row.body,
      source_url: row.source_url,
      content_hash: row.content_hash,
    },
    patch,
    previousContentHash: row.content_hash,
  };
}
