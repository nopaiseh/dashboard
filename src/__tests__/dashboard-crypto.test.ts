import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFieldAad,
  decryptField,
  encryptField,
  isEncryptedEnvelope,
  resetFieldKeyringCache,
} from "@/lib/crypto/fields-core";
import {
  decryptBlockPayload,
  encryptBlockPayload,
} from "@/lib/dashboard/crypto";
import { runDerivedCompute } from "@/lib/dashboard/compute";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const BLOCK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function setEnv(vars: Record<string, string | undefined>) {
  for (const name of [
    "FIELD_ENCRYPTION_KEY",
    "FIELD_ENCRYPTION_KEY_CURRENT",
    "FIELD_ENCRYPTION_STRICT",
    "NODE_ENV",
  ]) {
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

describe("dashboard block payload encryption", () => {
  it("round-trips JSON payload with dashboard_blocks AAD", () => {
    const payload = {
      title: "CPF 目标",
      progress: 0.42,
      items: ["a", "b"],
    };
    const enc = encryptBlockPayload(BLOCK_ID, payload);
    expect(isEncryptedEnvelope(enc)).toBe(true);
    expect(enc).not.toContain("CPF");
    expect(enc).not.toContain("0.42");
    const decrypted = decryptBlockPayload({ id: BLOCK_ID, payload: enc });
    expect(decrypted.decrypt_failed).toBeUndefined();
    expect(decrypted.payload).toEqual(payload);
  });

  it("binds AAD to entity dashboard_blocks (not items)", () => {
    const enc = encryptField(JSON.stringify({ text: "一行标题" }), {
      itemId: BLOCK_ID,
      column: "payload",
      entity: "dashboard_blocks",
    });
    expect(
      buildFieldAad(BLOCK_ID, "payload", 1, "dashboard_blocks"),
    ).toBe(`dashboard_blocks:${BLOCK_ID}:payload:v1`);
    expect(() =>
      decryptField(enc, {
        itemId: BLOCK_ID,
        column: "payload",
        entity: "items",
      }),
    ).toThrow(/AAD mismatch|decryption failed/);
    expect(
      decryptField(enc, {
        itemId: BLOCK_ID,
        column: "payload",
        entity: "dashboard_blocks",
      }),
    ).toBe(JSON.stringify({ text: "一行标题" }));
  });

  it("runDerivedCompute decrypts in memory without storing", () => {
    const enc = encryptBlockPayload(BLOCK_ID, {
      title: "余额",
      value: 1000,
    });
    const result = runDerivedCompute<{ title: string; value: number }, number>(
      { id: BLOCK_ID, payload: enc },
      {
        name: "double_metric",
        compute: (p) => p.value * 2,
      },
    );
    expect(result).toBe(2000);
  });
});
