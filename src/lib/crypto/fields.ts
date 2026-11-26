import "server-only";

/**
 * Server-only entry for item field encryption.
 * Implementation lives in fields-core.ts so one-off scripts (tsx) can import
 * without pulling `server-only`.
 */
export {
  buildFieldAad,
  decryptField,
  decryptItemSensitiveFields,
  decryptItemsSensitiveFields,
  decryptNullableField,
  encryptField,
  encryptItemSensitiveFields,
  encryptNullableField,
  FieldEncryptionConfigError,
  FieldEncryptionError,
  isEncryptedEnvelope,
  isFieldEncryptionStrict,
  loadFieldKeyring,
  parseEnvelope,
  parseKeyBase64,
  reportFieldDecryptFailure,
  resetFieldKeyringCache,
  setFieldDecryptFailureReporter,
  type DecryptItemResult,
  type FieldContext,
  type SensitiveColumn,
  type SensitiveItemFields,
} from "@/lib/crypto/fields-core";
