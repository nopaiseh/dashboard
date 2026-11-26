import "server-only";

/**
 * Server-only entry for item field encryption.
 * Implementation lives in fields-core.ts so one-off scripts (tsx) can import
 * without pulling `server-only`.
 */
export {
  decryptField,
  decryptItemSensitiveFields,
  decryptItemsSensitiveFields,
  decryptNullableField,
  encryptField,
  encryptItemSensitiveFields,
  encryptNullableField,
  FieldEncryptionError,
  isEncryptedEnvelope,
  loadFieldKeyring,
  resetFieldKeyringCache,
  type SensitiveItemFields,
} from "@/lib/crypto/fields-core";
