/**
 * Pure helpers for the encrypt-existing-fields backfill (testable without DB).
 *
 * Modes:
 * - encrypt: re-encrypt title/body/source_url with AAD (leave content_hash alone)
 * - rehash: recompute items.content_hash as HMAC (and optionally item_events — pending)
 */

import {
  computeContentHash,
  type ContentHashFields,
} from "@/lib/content-hash";
import {
  decryptField,
  decryptNullableField,
  encryptField,
  isEncryptedEnvelope,
  type SensitiveColumn,
} from "@/lib/crypto/fields-core";

export type BackfillMode = "encrypt" | "rehash";

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
      mode: BackfillMode;
      expected: {
        title: string;
        body: string;
        source_url: string | null;
        content_hash: string;
      };
      patch: {
        title?: string;
        body?: string;
        source_url?: string | null;
        content_hash?: string;
      };
      /** Previous content_hash when rehashing (for optional item_events rewrite). */
      previousContentHash?: string;
    };

function decryptColumn(
  itemId: string,
  column: SensitiveColumn,
  stored: string,
): string {
  return decryptField(stored, { itemId, column });
}

function plaintextFields(row: BackfillItemRow): {
  title: string;
  body: string;
  source_url: string | null;
} {
  return {
    title: decryptColumn(row.id, "title", row.title),
    body: decryptColumn(row.id, "body", row.body),
    source_url:
      row.source_url === null
        ? null
        : decryptNullableField(row.source_url, {
            itemId: row.id,
            column: "source_url",
          }),
  };
}

function planEncrypt(row: BackfillItemRow): BackfillPlan {
  const plain = plaintextFields(row);

  const alreadyEncrypted =
    isEncryptedEnvelope(row.title) &&
    isEncryptedEnvelope(row.body) &&
    (row.source_url === null || isEncryptedEnvelope(row.source_url));

  if (alreadyEncrypted) {
    // Confirm AAD binding: wrong-column decrypt must fail.
    try {
      decryptField(row.title, { itemId: row.id, column: "body" });
      // Wrong column succeeded — treat as needing re-encrypt (should not happen).
    } catch {
      return { action: "skip", reason: "already_migrated" };
    }
  }

  return {
    action: "update",
    mode: "encrypt",
    expected: {
      title: row.title,
      body: row.body,
      source_url: row.source_url,
      content_hash: row.content_hash,
    },
    patch: {
      title: encryptField(plain.title, { itemId: row.id, column: "title" }),
      body: encryptField(plain.body, { itemId: row.id, column: "body" }),
      source_url:
        plain.source_url === null
          ? null
          : encryptField(plain.source_url, {
              itemId: row.id,
              column: "source_url",
            }),
    },
  };
}

function planRehash(row: BackfillItemRow): BackfillPlan {
  const plain = plaintextFields(row);
  const hashFields: ContentHashFields = {
    kind: row.kind,
    title: plain.title,
    body: plain.body,
    options: row.options,
    source_url: plain.source_url,
    due_at: row.due_at,
  };
  const hmacHash = computeContentHash(hashFields);
  if (row.content_hash === hmacHash) {
    return { action: "skip", reason: "already_migrated" };
  }

  return {
    action: "update",
    mode: "rehash",
    expected: {
      title: row.title,
      body: row.body,
      source_url: row.source_url,
      content_hash: row.content_hash,
    },
    patch: {
      content_hash: hmacHash,
    },
    previousContentHash: row.content_hash,
  };
}

export function planItemBackfill(
  row: BackfillItemRow,
  mode: BackfillMode,
): BackfillPlan {
  return mode === "encrypt" ? planEncrypt(row) : planRehash(row);
}
