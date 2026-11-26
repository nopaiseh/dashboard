import { describe, expect, it } from "vitest";
import {
  hashAgentToken,
  safeEqualHex,
  sha256Hex,
  verifyAgentToken,
} from "@/lib/crypto";

describe("token hashing", () => {
  it("hashes bearer tokens with sha256 hex", () => {
    const raw = "sister-secret-token-example";
    const hash = hashAgentToken(raw);
    expect(hash).toBe(sha256Hex(raw));
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verifies matching token against stored hash", () => {
    const raw = "abc123";
    const stored = hashAgentToken(raw);
    expect(verifyAgentToken(raw, stored)).toBe(true);
    expect(verifyAgentToken("wrong", stored)).toBe(false);
  });

  it("uses constant-time equal for hex", () => {
    expect(safeEqualHex("aa", "aa")).toBe(true);
    expect(safeEqualHex("aa", "ab")).toBe(false);
    expect(safeEqualHex("a", "aa")).toBe(false);
  });
});
