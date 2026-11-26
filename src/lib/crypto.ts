import { createHash, timingSafeEqual } from "node:crypto";

/** SHA-256 hex digest of arbitrary UTF-8 text. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Constant-time compare of two hex digests (or any equal-length strings). */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  } catch {
    return false;
  }
}

/** Hash a raw agent bearer token for storage / lookup. */
export function hashAgentToken(rawToken: string): string {
  return sha256Hex(rawToken);
}

/** Verify a presented bearer token against a stored hash. */
export function verifyAgentToken(
  rawToken: string,
  storedHash: string,
): boolean {
  return safeEqualHex(hashAgentToken(rawToken), storedHash);
}
