import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planItemBackfill } from "@/lib/crypto/backfill-plan";
import {
  decryptField,
  decryptItemSensitiveFields,
  encryptField,
  encryptItemSensitiveFields,
  FieldEncryptionError,
  isEncryptedEnvelope,
  parseKeyBase64,
  resetFieldKeyringCache,
  setFieldDecryptFailureReporter,
} from "@/lib/crypto/fields";
import {
  computeContentHash,
  computeLegacyContentHash,
  matchesStoredContentHash,
  resetContentHashKeyCache,
} from "@/lib/content-hash";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const KEY_V2 = Buffer.alloc(32, 2).toString("base64");
const KEY_WRONG = Buffer.alloc(32, 9).toString("base64");
const HASH_KEY = Buffer.alloc(32, 3).toString("base64");

const ITEM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function setEnv(vars: Record<string, string | undefined>) {
  const names = [
    "FIELD_ENCRYPTION_KEY",
    "FIELD_ENCRYPTION_KEY_V1",
    "FIELD_ENCRYPTION_KEY_V2",
    "FIELD_ENCRYPTION_KEYS",
    "FIELD_ENCRYPTION_KEY_CURRENT",
    "FIELD_ENCRYPTION_STRICT",
    "CONTENT_HASH_KEY",
    "NODE_ENV",
    "NEXT_PHASE",
  ];
  for (const name of names) {
    delete process.env[name];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetFieldKeyringCache();
  resetContentHashKeyCache();
}

beforeEach(() => {
  setEnv({
    FIELD_ENCRYPTION_KEY: KEY_V1,
    CONTENT_HASH_KEY: HASH_KEY,
    NODE_ENV: "test",
  });
  setFieldDecryptFailureReporter(null);
});

afterEach(() => {
  setEnv({});
  setFieldDecryptFailureReporter(null);
});

describe("field encryption", () => {
  it("round-trips plaintext through AES-256-GCM envelope with AAD", () => {
    const plain = "批准：部署 desk.nopaiseh.com";
    const enc = encryptField(plain, { itemId: ITEM_A, column: "title" });
    expect(isEncryptedEnvelope(enc)).toBe(true);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptField(enc, { itemId: ITEM_A, column: "title" })).toBe(plain);
  });

  it("round-trips empty string (ciphertext segment may be empty)", () => {
    const enc = encryptField("", { itemId: ITEM_A, column: "body" });
    expect(isEncryptedEnvelope(enc)).toBe(true);
    expect(enc.split(":")).toHaveLength(4);
    expect(decryptField(enc, { itemId: ITEM_A, column: "body" })).toBe("");
  });

  it("uses a fresh IV each encrypt (ciphertext differs)", () => {
    const a = encryptField("same", { itemId: ITEM_A, column: "title" });
    const b = encryptField("same", { itemId: ITEM_A, column: "title" });
    expect(a).not.toBe(b);
    expect(decryptField(a, { itemId: ITEM_A, column: "title" })).toBe("same");
    expect(decryptField(b, { itemId: ITEM_A, column: "title" })).toBe("same");
  });

  it("detects tampering via GCM auth tag", () => {
    const enc = encryptField("secret", { itemId: ITEM_A, column: "title" });
    const parts = enc.split(":");
    const ct = Buffer.from(parts[3]!, "base64");
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    parts[3] = ct.toString("base64");
    const tampered = parts.join(":");
    expect(() =>
      decryptField(tampered, { itemId: ITEM_A, column: "title" }),
    ).toThrow(FieldEncryptionError);
  });

  it("detects ciphertext swapped across rows or columns (AAD)", () => {
    const encTitle = encryptField("secret", {
      itemId: ITEM_A,
      column: "title",
    });
    expect(() =>
      decryptField(encTitle, { itemId: ITEM_B, column: "title" }),
    ).toThrow(/AAD mismatch|decryption failed/);
    expect(() =>
      decryptField(encTitle, { itemId: ITEM_A, column: "body" }),
    ).toThrow(/AAD mismatch|decryption failed/);
  });

  it("fails closed with wrong key", () => {
    const enc = encryptField("secret", { itemId: ITEM_A, column: "title" });
    setEnv({
      FIELD_ENCRYPTION_KEY: KEY_WRONG,
      CONTENT_HASH_KEY: HASH_KEY,
      NODE_ENV: "test",
    });
    expect(() =>
      decryptField(enc, { itemId: ITEM_A, column: "title" }),
    ).toThrow(FieldEncryptionError);
  });

  it("decrypts with older key after rotation to v2", () => {
    setEnv({
      FIELD_ENCRYPTION_KEY_V1: KEY_V1,
      FIELD_ENCRYPTION_KEY_V2: KEY_V2,
      FIELD_ENCRYPTION_KEY_CURRENT: "1",
      CONTENT_HASH_KEY: HASH_KEY,
      NODE_ENV: "test",
    });
    const legacy = encryptField("old-row", { itemId: ITEM_A, column: "title" });
    expect(legacy.startsWith("v1:")).toBe(true);

    setEnv({
      FIELD_ENCRYPTION_KEY_V1: KEY_V1,
      FIELD_ENCRYPTION_KEY_V2: KEY_V2,
      FIELD_ENCRYPTION_KEY_CURRENT: "2",
      CONTENT_HASH_KEY: HASH_KEY,
      NODE_ENV: "test",
    });
    expect(decryptField(legacy, { itemId: ITEM_A, column: "title" })).toBe(
      "old-row",
    );
    const fresh = encryptField("new-row", { itemId: ITEM_A, column: "title" });
    expect(fresh.startsWith("v2:")).toBe(true);
    expect(decryptField(fresh, { itemId: ITEM_A, column: "title" })).toBe(
      "new-row",
    );
  });

  it("supports FIELD_ENCRYPTION_KEYS JSON map", () => {
    setEnv({
      FIELD_ENCRYPTION_KEYS: JSON.stringify({ "1": KEY_V1, "2": KEY_V2 }),
      FIELD_ENCRYPTION_KEY_CURRENT: "v2",
      CONTENT_HASH_KEY: HASH_KEY,
      NODE_ENV: "test",
    });
    const enc = encryptField("via-json", { itemId: ITEM_A, column: "body" });
    expect(enc.startsWith("v2:")).toBe(true);
    expect(decryptField(enc, { itemId: ITEM_A, column: "body" })).toBe(
      "via-json",
    );
  });

  it("passes through legacy plaintext on decrypt unless strict", () => {
    expect(decryptField("plain title", { itemId: ITEM_A, column: "title" })).toBe(
      "plain title",
    );
    expect(isEncryptedEnvelope("plain title")).toBe(false);

    setEnv({
      FIELD_ENCRYPTION_KEY: KEY_V1,
      CONTENT_HASH_KEY: HASH_KEY,
      FIELD_ENCRYPTION_STRICT: "1",
      NODE_ENV: "test",
    });
    expect(() =>
      decryptField("plain title", { itemId: ITEM_A, column: "title" }),
    ).toThrow(/STRICT/);
  });

  it("encrypts / decrypts item sensitive fields; null source_url stays null", () => {
    const row = {
      id: ITEM_A,
      title: "t",
      body: "",
      source_url: null as string | null,
      other: 1,
    };
    const enc = encryptItemSensitiveFields(row);
    expect(isEncryptedEnvelope(enc.title)).toBe(true);
    expect(isEncryptedEnvelope(enc.body)).toBe(true);
    expect(enc.source_url).toBeNull();
    expect(enc.other).toBe(1);
    expect(decryptItemSensitiveFields(enc)).toEqual({ ...row });
  });

  it("degrades a single row on decrypt failure and reports without secrets", () => {
    const reports: Array<Record<string, unknown>> = [];
    setFieldDecryptFailureReporter((info) => {
      reports.push(info);
    });
    const good = encryptItemSensitiveFields({
      id: ITEM_A,
      title: "ok",
      body: "b",
      source_url: null,
    });
    const bad = {
      id: ITEM_B,
      title: good.title, // wrong row AAD
      body: good.body,
      source_url: null as string | null,
    };
    const out = decryptItemSensitiveFields(bad);
    expect(out.decrypt_failed).toBe(true);
    expect(out.title).toBe("[无法解密]");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      itemId: ITEM_B,
      code: "item_decrypt_failed",
    });
    expect(JSON.stringify(reports[0])).not.toMatch(/ok|secret|KEY/);
  });

  it("fails closed in production when key is missing", () => {
    setEnv({ NODE_ENV: "production", CONTENT_HASH_KEY: HASH_KEY });
    expect(() =>
      encryptField("x", { itemId: ITEM_A, column: "title" }),
    ).toThrow(/required in production/);
  });

  it("rejects FIELD_ENCRYPTION_KEY and V1 when both set and differ", () => {
    setEnv({
      FIELD_ENCRYPTION_KEY: KEY_V1,
      FIELD_ENCRYPTION_KEY_V1: KEY_V2,
      CONTENT_HASH_KEY: HASH_KEY,
      NODE_ENV: "test",
    });
    expect(() =>
      encryptField("x", { itemId: ITEM_A, column: "title" }),
    ).toThrow(/both set but differ/);
  });

  it("allows FIELD_ENCRYPTION_KEY and V1 when both set and equal", () => {
    setEnv({
      FIELD_ENCRYPTION_KEY: KEY_V1,
      FIELD_ENCRYPTION_KEY_V1: KEY_V1,
      CONTENT_HASH_KEY: HASH_KEY,
      NODE_ENV: "test",
    });
    expect(
      decryptField(encryptField("ok", { itemId: ITEM_A, column: "title" }), {
        itemId: ITEM_A,
        column: "title",
      }),
    ).toBe("ok");
  });

  it("strict-parses base64 keys to exactly 32 bytes", () => {
    expect(() => parseKeyBase64("not-base64!!!", "X")).toThrow(/valid base64/);
    expect(() => parseKeyBase64(Buffer.alloc(16).toString("base64"), "X")).toThrow(
      /exactly 32/,
    );
    expect(parseKeyBase64(KEY_V1, "X")).toHaveLength(32);
  });
});

describe("content_hash HMAC", () => {
  const fields = {
    kind: "approval",
    title: "t",
    body: "",
    options: [],
    source_url: null as string | null,
    due_at: null as string | null,
  };

  it("uses HMAC and accepts legacy SHA during transition", () => {
    const hmac = computeContentHash(fields);
    const legacy = computeLegacyContentHash(fields);
    expect(hmac).not.toBe(legacy);
    expect(matchesStoredContentHash(hmac, fields)).toBe(true);
    expect(matchesStoredContentHash(legacy, fields)).toBe(true);
  });

  it("rejects legacy SHA when FIELD_ENCRYPTION_STRICT=1", () => {
    const legacy = computeLegacyContentHash(fields);
    setEnv({
      FIELD_ENCRYPTION_KEY: KEY_V1,
      CONTENT_HASH_KEY: HASH_KEY,
      FIELD_ENCRYPTION_STRICT: "1",
      NODE_ENV: "test",
    });
    expect(matchesStoredContentHash(legacy, fields)).toBe(false);
    expect(matchesStoredContentHash(computeContentHash(fields), fields)).toBe(
      true,
    );
  });

  it("fails closed in production without CONTENT_HASH_KEY", () => {
    setEnv({
      FIELD_ENCRYPTION_KEY: KEY_V1,
      NODE_ENV: "production",
    });
    expect(() => computeContentHash(fields)).toThrow(/CONTENT_HASH_KEY/);
  });
});

describe("backfill plan idempotency", () => {
  it("encrypt-only then skips; rehash-only then skips", () => {
    const legacyHash = computeLegacyContentHash({
      kind: "todo",
      title: "Hello",
      body: "",
      options: [],
      source_url: null,
      due_at: null,
    });
    const row = {
      id: ITEM_A,
      title: "Hello",
      body: "",
      source_url: null as string | null,
      kind: "todo",
      options: [],
      due_at: null as string | null,
      content_hash: legacyHash,
    };

    const enc1 = planItemBackfill(row, "encrypt");
    expect(enc1.action).toBe("update");
    if (enc1.action !== "update") return;
    expect(enc1.mode).toBe("encrypt");
    expect(isEncryptedEnvelope(enc1.patch.title!)).toBe(true);
    expect(isEncryptedEnvelope(enc1.patch.body!)).toBe(true);
    expect(enc1.patch.content_hash).toBeUndefined();

    const afterEncrypt = {
      ...row,
      title: enc1.patch.title!,
      body: enc1.patch.body!,
      source_url: enc1.patch.source_url ?? null,
    };
    expect(planItemBackfill(afterEncrypt, "encrypt").action).toBe("skip");

    const rehash1 = planItemBackfill(afterEncrypt, "rehash");
    expect(rehash1.action).toBe("update");
    if (rehash1.action !== "update") return;
    expect(rehash1.patch.content_hash).toBe(
      computeContentHash({
        kind: "todo",
        title: "Hello",
        body: "",
        options: [],
        source_url: null,
        due_at: null,
      }),
    );

    const afterRehash = {
      ...afterEncrypt,
      content_hash: rehash1.patch.content_hash!,
    };
    expect(planItemBackfill(afterRehash, "rehash").action).toBe("skip");
    expect(planItemBackfill(afterRehash, "encrypt").action).toBe("skip");
  });

  it("config errors are not swallowed by per-row degrade", () => {
    const sealed = encryptItemSensitiveFields({
      id: ITEM_A,
      title: "secret",
      body: "",
      source_url: null,
    });
    setEnv({ NODE_ENV: "test" }); // clear encryption key
    expect(() => decryptItemSensitiveFields(sealed)).toThrow(
      /not configured|FIELD_ENCRYPTION_KEY/,
    );
  });
});
