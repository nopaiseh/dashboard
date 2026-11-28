/**
 * Dashboard block payload encryption helpers.
 * Reuses items AES-256-GCM envelopes with AAD entity `dashboard_blocks`.
 * New tables: no legacy plaintext — only '' or a valid `v{digits}:` envelope.
 * Never log plaintext payloads.
 */

import {
  decryptField,
  encryptField,
  FieldEncryptionConfigError,
  FieldEncryptionError,
  isEncryptedEnvelope,
  reportFieldDecryptFailure,
} from "@/lib/crypto/fields-core";

export const DASHBOARD_BLOCKS_ENTITY = "dashboard_blocks";
export const DASHBOARD_PAYLOAD_COLUMN = "payload";

/** Matches DB CHECK: '' or envelope prefix v{digits}: */
const DASHBOARD_ENVELOPE_PREFIX_RE = /^v[0-9]+:/;

export function blockPayloadFieldContext(blockId: string) {
  return {
    itemId: blockId,
    column: DASHBOARD_PAYLOAD_COLUMN,
    entity: DASHBOARD_BLOCKS_ENTITY,
  } as const;
}

/**
 * Dashboard payloads have no plaintext legacy path.
 * Allowed: empty string, or a structurally valid envelope with `v{digits}:` prefix.
 * Key lookup by envelope version is handled by decryptField / the keyring.
 */
export function assertDashboardStoredPayload(stored: string): void {
  if (stored === "") return;
  if (
    !DASHBOARD_ENVELOPE_PREFIX_RE.test(stored) ||
    !isEncryptedEnvelope(stored)
  ) {
    throw new FieldEncryptionError(
      "dashboard payload is not a versioned envelope",
      "legacy_plaintext_rejected",
    );
  }
}

/** Encrypt a JSON-serializable payload for storage. */
export function encryptBlockPayload(
  blockId: string,
  payload: unknown,
): string {
  const plaintext = JSON.stringify(payload ?? {});
  return encryptField(plaintext, blockPayloadFieldContext(blockId));
}

/**
 * Decrypt payload to a plain object.
 * Config errors rethrow; ciphertext / non-envelope / unknown key version →
 * empty object + decrypt_failed.
 */
export function decryptBlockPayload(block: {
  id: string;
  payload: string;
}): { payload: Record<string, unknown>; decrypt_failed?: boolean } {
  try {
    if (block.payload === "") {
      return { payload: {} };
    }
    assertDashboardStoredPayload(block.payload);
    const plain = decryptField(
      block.payload,
      blockPayloadFieldContext(block.id),
    );
    const parsed: unknown = plain === "" ? {} : JSON.parse(plain);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { payload: {}, decrypt_failed: true };
    }
    return { payload: parsed as Record<string, unknown> };
  } catch (err) {
    if (err instanceof FieldEncryptionConfigError) {
      throw err;
    }
    const code =
      err instanceof FieldEncryptionError
        ? err.code
        : err instanceof SyntaxError
          ? "payload_json_invalid"
          : "block_decrypt_failed";
    reportFieldDecryptFailure({
      itemId: block.id,
      column: DASHBOARD_PAYLOAD_COLUMN,
      code,
    });
    return { payload: {}, decrypt_failed: true };
  }
}

/** Decrypt for write/compute paths that must fail closed on bad ciphertext. */
export function decryptBlockPayloadStrict(block: {
  id: string;
  payload: string;
}): Record<string, unknown> {
  if (block.payload === "") {
    return {};
  }
  assertDashboardStoredPayload(block.payload);
  const plain = decryptField(
    block.payload,
    blockPayloadFieldContext(block.id),
  );
  const parsed: unknown = plain === "" ? {} : JSON.parse(plain);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FieldEncryptionError("dashboard payload is not a JSON object");
  }
  return parsed as Record<string, unknown>;
}
