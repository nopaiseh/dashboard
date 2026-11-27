import { createHash } from "node:crypto";
import {
  hmacSha256Hex,
  isFieldEncryptionStrict,
  parseKeyBase64,
  resetFieldKeyringCache,
  safeEqualString,
} from "@/lib/crypto/fields-core";
import type { ItemKind, ItemOption } from "@/lib/types";

/** Canonical options array (sorted by key) for stable hashing. */
export function canonicalizeOptions(
  options: ItemOption[] | unknown,
): ItemOption[] {
  const list = Array.isArray(options) ? options : [];
  return list
    .map((o) => {
      const row = o as ItemOption;
      return { key: String(row.key ?? ""), label: String(row.label ?? "") };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * 统一 due_at 为 ISO-8601 UTC（`…Z`）。
 * Postgres timestamptz 经 PostgREST 常返回 `…+00:00`，新建时多为 `…Z`，
 * 不规范化会导致 content_hash 误判变更。
 */
export function normalizeDueAt(dueAt: string | null | undefined): string | null {
  if (dueAt == null || dueAt === "") {
    return null;
  }
  const ms = Date.parse(dueAt);
  if (Number.isNaN(ms)) {
    return dueAt;
  }
  return new Date(ms).toISOString();
}

export interface ContentHashFields {
  kind: ItemKind | string;
  title: string;
  body: string;
  options: ItemOption[] | unknown;
  source_url: string | null;
  due_at: string | null;
}

function serializeContentPayload(fields: ContentHashFields): string {
  return JSON.stringify([
    fields.kind,
    fields.title,
    fields.body,
    canonicalizeOptions(fields.options),
    fields.source_url,
    normalizeDueAt(fields.due_at),
  ]);
}

function isProductionBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}

let cachedContentHashKey: Buffer | null | undefined;

/** Test helper. */
export function resetContentHashKeyCache(): void {
  cachedContentHashKey = undefined;
  resetFieldKeyringCache();
}

/**
 * CONTENT_HASH_KEY: base64 32 bytes. Fail closed in production.
 * Used for HMAC-SHA256 content_hash (not the field encryption key).
 */
export function loadContentHashKey(): Buffer | null {
  if (cachedContentHashKey !== undefined) {
    return cachedContentHashKey;
  }
  const raw = process.env.CONTENT_HASH_KEY;
  if (!raw) {
    if (isProductionRuntime()) {
      throw new Error("CONTENT_HASH_KEY is required in production");
    }
    if (isProductionBuild()) {
      cachedContentHashKey = Buffer.alloc(32, 0);
      return cachedContentHashKey;
    }
    cachedContentHashKey = null;
    return null;
  }
  cachedContentHashKey = parseKeyBase64(raw, "CONTENT_HASH_KEY");
  return cachedContentHashKey;
}

function requireContentHashKey(): Buffer {
  const key = loadContentHashKey();
  if (!key) {
    throw new Error(
      "CONTENT_HASH_KEY is not configured; cannot compute content_hash",
    );
  }
  return key;
}

/**
 * content_hash = HMAC-SHA256(CONTENT_HASH_KEY, JSON.stringify([kind, title, body, options, source_url, due_at]))
 * 用 JSON 数组序列化避免拼接歧义；纳入 source_url / due_at / kind。
 * due_at 在序列化前规范化为 toISOString()。
 */
export function computeContentHash(fields: ContentHashFields): string {
  const payload = serializeContentPayload(fields);
  return hmacSha256Hex(requireContentHashKey(), payload);
}

/** Pre-HMAC legacy: plain SHA-256 of the same payload (transition only). */
export function computeLegacyContentHash(fields: ContentHashFields): string {
  const payload = serializeContentPayload(fields);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Compare a stored content_hash to fields.
 * During transition (strict off): accept HMAC or legacy SHA-256.
 * After FIELD_ENCRYPTION_STRICT=1: HMAC only.
 */
export function matchesStoredContentHash(
  stored: string,
  fields: ContentHashFields,
): boolean {
  const hmac = computeContentHash(fields);
  if (safeEqualString(stored, hmac)) {
    return true;
  }
  if (isFieldEncryptionStrict()) {
    return false;
  }
  const legacy = computeLegacyContentHash(fields);
  return safeEqualString(stored, legacy);
}

export function isDecisionValid(
  eventContentHash: string | null | undefined,
  currentContentHash: string,
): boolean {
  if (!eventContentHash) {
    return false;
  }
  return eventContentHash === currentContentHash;
}

export function annotateInvalidated<T extends { content_hash: string | null }>(
  event: T,
  currentContentHash: string,
): T & { invalidated: boolean } {
  return {
    ...event,
    invalidated: !isDecisionValid(event.content_hash, currentContentHash),
  };
}
