import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Application-layer AES-256-GCM for items.title / items.body / items.source_url.
 *
 * Envelope (UTF-8 text stored in the column):
 *   v{N}:{iv_b64}:{tag_b64}:{ciphertext_b64}
 * where N is the key version, IV is 12 random bytes, tag is the 16-byte GCM auth tag.
 * Ciphertext may be empty (empty plaintext) — envelope segments use `*` quantifiers.
 *
 * AAD (bound into GCM): `items:{id}:{column}:v{N}` so ciphertext cannot be
 * swapped across rows or columns.
 *
 * Keyring (pick one style; current key encrypts, all listed keys decrypt):
 *   1) FIELD_ENCRYPTION_KEY=<base64 32 bytes>          → version 1
 *   2) FIELD_ENCRYPTION_KEY_V1 / _V2 / … + FIELD_ENCRYPTION_KEY_CURRENT=1|2|…
 *   3) FIELD_ENCRYPTION_KEYS='{"1":"<b64>","2":"<b64>"}' + FIELD_ENCRYPTION_KEY_CURRENT=2
 *
 * FIELD_ENCRYPTION_STRICT=1 disables legacy plaintext fallback.
 * Never log keys or plaintext. Production fails closed if no key is configured
 * (except `next build`, which uses the same placeholder pattern as other secrets).
 * Config errors (missing/wrong keys) always throw; only per-row ciphertext
 * failure is degraded on read paths (Vercel structured console.error).
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;
/** Base64 segment: zero or more chars (empty ciphertext is valid). */
const B64_SEGMENT = "[A-Za-z0-9+/]*={0,2}";
const ENVELOPE_RE = new RegExp(
  `^v(\\d+):(${B64_SEGMENT}):(${B64_SEGMENT}):(${B64_SEGMENT})$`,
);

export type SensitiveColumn = "title" | "body" | "source_url";

export class FieldEncryptionError extends Error {
  /** Stable machine code for logs / UI (e.g. unknown_key_version). */
  readonly code: string;

  constructor(message: string, code = "field_decrypt_failed") {
    super(message);
    this.name = "FieldEncryptionError";
    this.code = code;
  }
}

/** Missing / invalid keyring — must not be swallowed by per-row degrade. */
export class FieldEncryptionConfigError extends FieldEncryptionError {
  constructor(message: string) {
    super(message, "field_encryption_config");
    this.name = "FieldEncryptionConfigError";
  }
}

export interface SensitiveItemFields {
  id: string;
  title: string;
  body: string;
  source_url: string | null;
}

export interface FieldContext {
  itemId: string;
  column: SensitiveColumn;
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

export function isFieldEncryptionStrict(): boolean {
  const v = process.env.FIELD_ENCRYPTION_STRICT;
  return v === "1" || v === "true" || v === "yes";
}

/** Strict base64 → exactly KEY_BYTES; rejects silent truncation / junk. */
export function parseKeyBase64(raw: string, label: string): Buffer {
  const normalized = raw.trim().replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new FieldEncryptionConfigError(`${label} is not valid base64`);
  }
  const buf = Buffer.from(normalized, "base64");
  if (buf.length !== KEY_BYTES) {
    throw new FieldEncryptionConfigError(
      `${label} must decode to exactly ${KEY_BYTES} bytes (got ${buf.length})`,
    );
  }
  // Round-trip: reject inputs Node would accept with ignored characters.
  const reencoded = buf.toString("base64");
  if (reencoded !== normalized) {
    throw new FieldEncryptionConfigError(
      `${label} is not strict base64 (round-trip mismatch)`,
    );
  }
  return buf;
}

function parseCurrentVersion(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.startsWith("v") ? raw.slice(1) : raw;
  const n = Number.parseInt(normalized, 10);
  if (!Number.isInteger(n) || n < 1) {
    throw new FieldEncryptionConfigError(
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
    throw new FieldEncryptionConfigError("FIELD_ENCRYPTION_KEYS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FieldEncryptionConfigError(
      "FIELD_ENCRYPTION_KEYS must be a JSON object of version → base64 key",
    );
  }
  const keys = new Map<number, Buffer>();
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const version = Number.parseInt(k.startsWith("v") ? k.slice(1) : k, 10);
    if (!Number.isInteger(version) || version < 1) {
      throw new FieldEncryptionConfigError(
        `FIELD_ENCRYPTION_KEYS has invalid version key: ${k}`,
      );
    }
    if (typeof v !== "string") {
      throw new FieldEncryptionConfigError(
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
    const fromSingle = parseKeyBase64(single, "FIELD_ENCRYPTION_KEY");
    const existingV1 = keys.get(1);
    if (existingV1 && !existingV1.equals(fromSingle)) {
      throw new FieldEncryptionConfigError(
        "FIELD_ENCRYPTION_KEY and FIELD_ENCRYPTION_KEY_V1 are both set but differ",
      );
    }
    keys.set(1, fromSingle);
  }

  if (keys.size === 0) {
    if (isProductionRuntime()) {
      throw new FieldEncryptionConfigError(
        "FIELD_ENCRYPTION_KEY (or FIELD_ENCRYPTION_KEY_V* / FIELD_ENCRYPTION_KEYS) is required in production",
      );
    }
    if (isProductionBuild()) {
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
    throw new FieldEncryptionConfigError(
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
    throw new FieldEncryptionConfigError(
      "FIELD_ENCRYPTION_KEY is not configured; cannot encrypt or decrypt fields",
    );
  }
  return ring;
}

export function buildFieldAad(
  itemId: string,
  column: SensitiveColumn,
  version: number,
): string {
  return `items:${itemId}:${column}:v${version}`;
}

export type ParsedEnvelope = {
  version: number;
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
};

/** Parse and validate envelope structure (IV/tag lengths). */
export function parseEnvelope(value: string): ParsedEnvelope | null {
  const match = ENVELOPE_RE.exec(value);
  if (!match) return null;
  const version = Number.parseInt(match[1], 10);
  if (!Number.isInteger(version) || version < 1) return null;
  let iv: Buffer;
  let tag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(match[2], "base64");
    tag = Buffer.from(match[3], "base64");
    ciphertext = Buffer.from(match[4], "base64");
  } catch {
    return null;
  }
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  return { version, iv, tag, ciphertext };
}

/** True when value is a structurally valid ciphertext envelope. */
export function isEncryptedEnvelope(value: string): boolean {
  return parseEnvelope(value) !== null;
}

export function encryptField(plaintext: string, ctx: FieldContext): string {
  const ring = requireKeyring();
  const version = ring.currentVersion;
  const key = ring.keys.get(version);
  if (!key) {
    throw new FieldEncryptionConfigError(
      "current encryption key missing from keyring",
    );
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const aad = buildFieldAad(ctx.itemId, ctx.column, version);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) {
    throw new FieldEncryptionError("unexpected GCM tag length");
  }
  return `v${version}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

/**
 * Decrypt a stored field.
 * - Valid envelope → AES-GCM with AAD (required).
 * - Non-envelope → legacy plaintext passthrough unless FIELD_ENCRYPTION_STRICT.
 */
export function decryptField(stored: string, ctx: FieldContext): string {
  const envelope = parseEnvelope(stored);
  if (!envelope) {
    if (isFieldEncryptionStrict()) {
      throw new FieldEncryptionError(
        "legacy plaintext rejected (FIELD_ENCRYPTION_STRICT)",
      );
    }
    return stored;
  }

  const ring = requireKeyring();
  const key = ring.keys.get(envelope.version);
  if (!key) {
    // Keyring loaded OK but this envelope version is absent → degrade this row only.
    throw new FieldEncryptionError(
      `no decryption key for envelope version v${envelope.version}`,
      "unknown_key_version",
    );
  }

  const aad = buildFieldAad(ctx.itemId, ctx.column, envelope.version);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, envelope.iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(envelope.tag);
    return Buffer.concat([
      decipher.update(envelope.ciphertext),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new FieldEncryptionError(
      "field decryption failed (tampered, wrong key, or AAD mismatch)",
    );
  }
}

export function encryptNullableField(
  value: string | null,
  ctx: FieldContext,
): string | null {
  if (value === null) return null;
  return encryptField(value, ctx);
}

export function decryptNullableField(
  value: string | null,
  ctx: FieldContext,
): string | null {
  if (value === null) return null;
  return decryptField(value, ctx);
}

/** Encrypt title / body / source_url for DB write. Requires row.id. */
export function encryptItemSensitiveFields<T extends SensitiveItemFields>(
  row: T,
): T {
  const id = row.id;
  return {
    ...row,
    title: encryptField(row.title, { itemId: id, column: "title" }),
    body: encryptField(row.body, { itemId: id, column: "body" }),
    source_url: encryptNullableField(row.source_url, {
      itemId: id,
      column: "source_url",
    }),
  };
}

export type DecryptItemResult<T> = T & { decrypt_failed?: boolean };

const DECRYPT_PLACEHOLDER_TITLE = "[无法解密]";

type DecryptFailureReporter = (info: {
  itemId: string;
  column: SensitiveColumn | "item";
  code: string;
}) => void;

let decryptFailureReporter: DecryptFailureReporter | null = null;

/** Inject reporter for tests. Never pass plaintext or keys. */
export function setFieldDecryptFailureReporter(
  reporter: DecryptFailureReporter | null,
): void {
  decryptFailureReporter = reporter;
}

/** Structured Vercel/runtime log — no plaintext, keys, or ciphertext. */
export function reportFieldDecryptFailure(info: {
  itemId: string;
  column: SensitiveColumn | "item";
  code: string;
}): void {
  console.error("[field-crypto] decrypt failed", {
    itemId: info.itemId,
    column: info.column,
    code: info.code,
  });
  decryptFailureReporter?.(info);
}

/**
 * Decrypt title / body / source_url after DB read.
 * Per-row ciphertext failure → placeholder + decrypt_failed (reads only).
 * Config errors (missing/invalid keys) always rethrow.
 */
export function decryptItemSensitiveFields<T extends SensitiveItemFields>(
  row: T,
): DecryptItemResult<T> {
  try {
    return {
      ...row,
      title: decryptField(row.title, { itemId: row.id, column: "title" }),
      body: decryptField(row.body, { itemId: row.id, column: "body" }),
      source_url: decryptNullableField(row.source_url, {
        itemId: row.id,
        column: "source_url",
      }),
    };
  } catch (err) {
    if (err instanceof FieldEncryptionConfigError) {
      throw err;
    }
    const code =
      err instanceof FieldEncryptionError
        ? err.code
        : "item_decrypt_failed";
    reportFieldDecryptFailure({
      itemId: row.id,
      column: "item",
      code,
    });
    return {
      ...row,
      title: DECRYPT_PLACEHOLDER_TITLE,
      body: "",
      source_url: null,
      decrypt_failed: true,
    };
  }
}

export function decryptItemsSensitiveFields<T extends SensitiveItemFields>(
  rows: T[],
): DecryptItemResult<T>[] {
  return rows.map((row) => decryptItemSensitiveFields(row));
}

/** Constant-time compare of equal-length digests. */
export function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

export function hmacSha256Hex(key: Buffer, payload: string): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("hex");
}
