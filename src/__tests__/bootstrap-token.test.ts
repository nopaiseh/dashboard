import { afterEach, describe, expect, it } from "vitest";
import {
  BOOTSTRAP_TOKEN_MIN_BYTES,
  getConfiguredBootstrapToken,
  matchesBootstrapToken,
} from "@/lib/bootstrap-token";
import { hashAgentToken, safeEqualHex } from "@/lib/crypto";

const LONG_TOKEN = "a".repeat(BOOTSTRAP_TOKEN_MIN_BYTES);
const SHORT_TOKEN = "short-token-only-16"; // < 32 bytes

describe("BOOTSTRAP_TOKEN strength and constant-time compare", () => {
  afterEach(() => {
    delete process.env.BOOTSTRAP_TOKEN;
  });

  it("treats tokens shorter than 32 bytes as not configured", () => {
    process.env.BOOTSTRAP_TOKEN = SHORT_TOKEN;
    expect(Buffer.byteLength(SHORT_TOKEN, "utf8")).toBeLessThan(
      BOOTSTRAP_TOKEN_MIN_BYTES,
    );
    expect(getConfiguredBootstrapToken()).toBeNull();
    expect(matchesBootstrapToken(SHORT_TOKEN)).toBe(false);
    expect(matchesBootstrapToken(LONG_TOKEN)).toBe(false);
  });

  it("accepts >=32-byte token via hash then timingSafeEqual", () => {
    process.env.BOOTSTRAP_TOKEN = LONG_TOKEN;
    expect(getConfiguredBootstrapToken()).toBe(LONG_TOKEN);
    expect(matchesBootstrapToken(LONG_TOKEN)).toBe(true);
    expect(matchesBootstrapToken(`${LONG_TOKEN}x`)).toBe(false);

    // 先哈希再比，哈希等长故可用 timingSafeEqual
    expect(
      safeEqualHex(hashAgentToken(LONG_TOKEN), hashAgentToken(LONG_TOKEN)),
    ).toBe(true);
  });
});
