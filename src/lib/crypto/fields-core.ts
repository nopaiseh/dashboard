import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-layer AES-256-GCM for items.title / items.body / items.source_url.
 *
 * Envelope (UTF-8 text stored in the column):
 *   v{N}:{iv_b64}:{tag_b64}:{ciphertext_b64}
 * where N is the key version, IV is 12 random bytes, tag is the 16-byte GCM auth tag.
 *
 * Keyring (pick one style; current key encrypts, all listed keys decrypt):
 *   1) FIELD_ENCRYPTION_KEY=<base64 32 bytes>          → version 1
 *   2) FIELD_ENCRYPTION_KEY_V1 / _V2 / … + FIELD_ENCRYPTION_KEY_CURRENT=1|2|…
 *   3) FIELD_ENCRYPTION_KEYS='{"1":"<b64>","2":"<b64>"}' + FIELD_ENCRYPTION_KEY_CURRENT=2
 *
 * Reads tolerate legacy plaintext (no `vN:` envelope) during migration.
 * Never log keys or plaintext. Production fails closed if no key is configured
 * (except `next build`, which uses the same placeholder pattern as other secrets).
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
const ENVELOPE_RE =
  /^v(\d+):([A-Za-z0-9+/]+=*):([A-Za-z0-9+/]+=*):([A-Za-z0-9+/]+=*)$/;

export class FieldEncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldEncryptionError";
  }
}

export interface SensitiveItemFields {
  title: string;
  body: string;
  source_url: string | null;
}

type Keyring = {
  currentVersion: number;
  keys: Map<number, Buffer>;
};

let cachedKeyring: Keyring | null | undefined;

function isProductionBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

function parseKeyBase64(raw: string, label: string): Buffer {
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new FieldEncryptionError(`${label} is not valid base64`);
  }
  if (buf.length !== KEY_BYTES) {
    throw new FieldEncryptionError(
      `${label} must decode to exactly ${KEY_BYTES} bytes (got ${buf.length})`,
    );
  }
  return buf;
}

function parseCurrentVersion(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.startsWith("v") ? raw.slice(1) : raw;
  const n = Number.parseInt(normalized, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new FieldEncryptionError(
      "FIELD_ENCRYPTION_KEY_CURRENT must be a positive integer (e.g. 1 or v1)",
    );
  }
  return n;
}

function collectVersionedEnvKeys(): Map<number, Buffer> {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^FIELD_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    if (!match || !value) continue;
    const version = Number.parseInt(match[1], 10);
    keys.set(version, parseKeyBase64(value, name));
  }
  return keys;
}

function collectJsonKeys(): Map<number, Buffer> {
  const raw = process.env.FIELD_ENCRYPTION_KEYS;
  if (!raw) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new FieldEncryptionError("FIELD_ENCRYPTION_KEYS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FieldEncryptionError(
      "FIELD_ENCRYPTION_KEYS must be a JSON object of version → base64 key",
    );
  }
  const keys = new Map<number, Buffer>();
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const version = Number.parseInt(k.startsWith("v") ? k.slice(1) : k, 10);
    if (!Number.isInteger(version) || version < 1) {
      throw new FieldEncryptionError(
        `FIELD_ENCRYPTION_KEYS has invalid version key: ${k}`,
      );
    }
    if (typeof v !== "string") {
      throw new FieldEncryptionError(
        `FIELD_ENCRYPTION_KEYS[${k}] must be a base64 string`,
      );
    }
    keys.set(version, parseKeyBase64(v, `FIELD_ENCRYPTION_KEYS[${k}]`));
  }
  return keys;
}

/**
 * Resolve the keyring from env. Returns null only when no keys are configured
 * and we are not in a production runtime (dev / build placeholder path).
 */
export function loadFieldKeyring(): Keyring | null {
  if (cachedKeyring !== undefined) {
    return cachedKeyring;
  }

  const fromJson = collectJsonKeys();
  const fromVersioned = collectVersionedEnvKeys();
  const keys = new Map<number, Buffer>([...fromVersioned, ...fromJson]);

  const single = process.env.FIELD_ENCRYPTION_KEY;
  if (single) {
    if (!keys.has(1)) {
      keys.set(1, parseKeyBase64(single, "FIELD_ENCRYPTION_KEY"));
    }
  }

  if (keys.size === 0) {
    if (isProductionRuntime()) {
      throw new FieldEncryptionError(
        "FIELD_ENCRYPTION_KEY (or FIELD_ENCRYPTION_KEY_V* / FIELD_ENCRYPTION_KEYS) is required in production",
      );
    }
    if (isProductionBuild()) {
      // Allow `next build` without secrets; runtime still fails closed.
      const placeholder = Buffer.alloc(KEY_BYTES, 0);
      cachedKeyring = { currentVersion: 1, keys: new Map([[1, placeholder]]) };
      return cachedKeyring;
    }
    cachedKeyring = null;
    return null;
  }

  const currentVersion = parseCurrentVersion(
    process.env.FIELD_ENCRYPTION_KEY_CURRENT,
    keys.has(1) ? 1 : Math.min(...keys.keys()),
  );
  if (!keys.has(currentVersion)) {
    throw new FieldEncryptionError(
      `FIELD_ENCRYPTION_KEY_CURRENT=${currentVersion} has no matching key in the keyring`,
    );
  }

  cachedKeyring = { currentVersion, keys };
  return cachedKeyring;
}

/** Test helper: clear cached keyring so env changes take effect. */
export function resetFieldKeyringCache(): void {
  cachedKeyring = undefined;
}

function requireKeyring(): Keyring {
  const ring = loadFieldKeyring();
  if (!ring) {
    throw new FieldEncryptionError(
      "FIELD_ENCRYPTION_KEY is not configured; cannot encrypt or decrypt fields",
    );
  }
  return ring;
}

/** True when value looks like our ciphertext envelope (not legacy plaintext). */
export function isEncryptedEnvelope(value: string): boolean {
  return ENVELOPE_RE.test(value);
}

export function encryptField(plaintext: string): string {
  const ring = requireKeyring();
  const key = ring.keys.get(ring.currentVersion);
  if (!key) {
    throw new FieldEncryptionError("current encryption key missing from keyring");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) {
    throw new FieldEncryptionError("unexpected GCM tag length");
  }
  return `v${ring.currentVersion}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypt a stored field. Legacy plaintext (no envelope) is returned unchanged
 * so reads keep working during backfill.
 */
export function decryptField(stored: string): string {
  const match = ENVELOPE_RE.exec(stored);
  if (!match) {
    return stored;
  }
  const version = Number.parseInt(match[1], 10);
  const iv = Buffer.from(match[2], "base64");
  const tag = Buffer.from(match[3], "base64");
  const ciphertext = Buffer.from(match[4], "base64");

  if (iv.length !== IV_BYTES) {
    throw new FieldEncryptionError("invalid IV length in ciphertext envelope");
  }
  if (tag.length !== TAG_BYTES) {
    throw new FieldEncryptionError("invalid auth tag length in ciphertext envelope");
  }

  const ring = requireKeyring();
  const key = ring.keys.get(version);
  if (!key) {
    throw new FieldEncryptionError(
      `no decryption key for envelope version v${version}`,
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Do not surface crypto internals or ciphertext; fail closed.
    throw new FieldEncryptionError("field decryption failed (tampered or wrong key)");
  }
}

export function encryptNullableField(value: string | null): string | null {
  if (value === null) return null;
  return encryptField(value);
}

export function decryptNullableField(value: string | null): string | null {
  if (value === null) return null;
  return decryptField(value);
}

/** Encrypt title / body / source_url for DB write. content_hash stays plaintext-based. */
export function encryptItemSensitiveFields<T extends SensitiveItemFields>(
  row: T,
): T {
  return {
    ...row,
    title: encryptField(row.title),
    body: encryptField(row.body),
    source_url: encryptNullableField(row.source_url),
  };
}

/** Decrypt title / body / source_url after DB read (legacy plaintext passthrough). */
export function decryptItemSensitiveFields<T extends SensitiveItemFields>(
  row: T,
): T {
  return {
    ...row,
    title: decryptField(row.title),
    body: decryptField(row.body),
    source_url: decryptNullableField(row.source_url),
  };
}

export function decryptItemsSensitiveFields<T extends SensitiveItemFields>(
  rows: T[],
): T[] {
  return rows.map((row) => decryptItemSensitiveFields(row));
}
