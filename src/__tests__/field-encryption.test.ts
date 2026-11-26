import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptField,
  decryptItemSensitiveFields,
  encryptField,
  encryptItemSensitiveFields,
  FieldEncryptionError,
  isEncryptedEnvelope,
  resetFieldKeyringCache,
} from "@/lib/crypto/fields";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const KEY_V2 = Buffer.alloc(32, 2).toString("base64");
const KEY_WRONG = Buffer.alloc(32, 9).toString("base64");

function setEnv(vars: Record<string, string | undefined>) {
  const names = [
    "FIELD_ENCRYPTION_KEY",
    "FIELD_ENCRYPTION_KEY_V1",
    "FIELD_ENCRYPTION_KEY_V2",
    "FIELD_ENCRYPTION_KEYS",
    "FIELD_ENCRYPTION_KEY_CURRENT",
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
}

beforeEach(() => {
  setEnv({
    FIELD_ENCRYPTION_KEY: KEY_V1,
    NODE_ENV: "test",
  });
});

afterEach(() => {
  setEnv({});
});

describe("field encryption", () => {
  it("round-trips plaintext through AES-256-GCM envelope", () => {
    const plain = "批准：部署 desk.nopaiseh.com";
    const enc = encryptField(plain);
    expect(isEncryptedEnvelope(enc)).toBe(true);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptField(enc)).toBe(plain);
  });

  it("uses a fresh IV each encrypt (ciphertext differs)", () => {
    const a = encryptField("same");
    const b = encryptField("same");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe("same");
    expect(decryptField(b)).toBe("same");
  });

  it("detects tampering via GCM auth tag", () => {
    const enc = encryptField("secret");
    const parts = enc.split(":");
    // Flip a byte in the ciphertext segment.
    const ct = Buffer.from(parts[3], "base64");
    ct[0] = ct[0]! ^ 0xff;
    parts[3] = ct.toString("base64");
    const tampered = parts.join(":");
    expect(() => decryptField(tampered)).toThrow(FieldEncryptionError);
    expect(() => decryptField(tampered)).toThrow(/decryption failed/);
  });

  it("fails closed with wrong key", () => {
    const enc = encryptField("secret");
    setEnv({ FIELD_ENCRYPTION_KEY: KEY_WRONG, NODE_ENV: "test" });
    expect(() => decryptField(enc)).toThrow(FieldEncryptionError);
  });

  it("decrypts with older key after rotation to v2", () => {
    setEnv({
      FIELD_ENCRYPTION_KEY_V1: KEY_V1,
      FIELD_ENCRYPTION_KEY_V2: KEY_V2,
      FIELD_ENCRYPTION_KEY_CURRENT: "1",
      NODE_ENV: "test",
    });
    const legacy = encryptField("old-row");
    expect(legacy.startsWith("v1:")).toBe(true);

    setEnv({
      FIELD_ENCRYPTION_KEY_V1: KEY_V1,
      FIELD_ENCRYPTION_KEY_V2: KEY_V2,
      FIELD_ENCRYPTION_KEY_CURRENT: "2",
      NODE_ENV: "test",
    });
    expect(decryptField(legacy)).toBe("old-row");
    const fresh = encryptField("new-row");
    expect(fresh.startsWith("v2:")).toBe(true);
    expect(decryptField(fresh)).toBe("new-row");
  });

  it("supports FIELD_ENCRYPTION_KEYS JSON map", () => {
    setEnv({
      FIELD_ENCRYPTION_KEYS: JSON.stringify({ "1": KEY_V1, "2": KEY_V2 }),
      FIELD_ENCRYPTION_KEY_CURRENT: "v2",
      NODE_ENV: "test",
    });
    const enc = encryptField("via-json");
    expect(enc.startsWith("v2:")).toBe(true);
    expect(decryptField(enc)).toBe("via-json");
  });

  it("passes through legacy plaintext on decrypt", () => {
    expect(decryptField("plain title")).toBe("plain title");
    expect(isEncryptedEnvelope("plain title")).toBe(false);
  });

  it("encrypts / decrypts item sensitive fields; null source_url stays null", () => {
    const row = {
      title: "t",
      body: "b",
      source_url: null as string | null,
      other: 1,
    };
    const enc = encryptItemSensitiveFields(row);
    expect(isEncryptedEnvelope(enc.title)).toBe(true);
    expect(isEncryptedEnvelope(enc.body)).toBe(true);
    expect(enc.source_url).toBeNull();
    expect(enc.other).toBe(1);
    expect(decryptItemSensitiveFields(enc)).toEqual(row);
  });

  it("fails closed in production when key is missing", () => {
    setEnv({ NODE_ENV: "production" });
    expect(() => encryptField("x")).toThrow(/required in production/);
  });
});
