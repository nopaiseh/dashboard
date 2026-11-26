import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CompactSign } from "jose";
import {
  SESSION_ABSOLUTE_MAX,
  SESSION_IDLE_MS,
  createSessionToken,
  touchSessionToken,
  verifySessionToken,
} from "@/lib/session";

const SECRET = "test-session-secret-at-least-32-chars!!";

async function signWithoutIat(nowSec: number): Promise<string> {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      sub: "owner",
      lastActivity: nowSec,
      exp: nowSec + Math.floor(SESSION_IDLE_MS / 1000),
    }),
  );
  return new CompactSign(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(SECRET));
}

describe("session absolute max + sliding renew", () => {
  beforeAll(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  afterAll(() => {
    delete process.env.SESSION_SECRET;
  });

  it("records iat on first login and preserves it across sliding renew", async () => {
    const issuedAt = new Date("2025-01-01T00:00:00.000Z");
    const token = await createSessionToken(issuedAt);
    const session = await verifySessionToken(token, issuedAt);
    expect(session).not.toBeNull();
    expect(session!.iat).toBe(Math.floor(issuedAt.getTime() / 1000));

    const later = new Date(issuedAt.getTime() + 60 * 60 * 1000);
    const renewed = await touchSessionToken(token, later);
    expect(renewed).not.toBeNull();
    const renewedSession = await verifySessionToken(renewed!, later);
    expect(renewedSession!.iat).toBe(session!.iat);
    expect(renewedSession!.lastActivity).toBe(
      Math.floor(later.getTime() / 1000),
    );
  });

  it("rejects sessions past SESSION_ABSOLUTE_MAX even if idle is fresh", async () => {
    const issuedAt = new Date("2025-01-01T00:00:00.000Z");
    const iatSec = Math.floor(issuedAt.getTime() / 1000);

    const nearExpiry = new Date(
      issuedAt.getTime() + SESSION_ABSOLUTE_MAX - 60_000,
    );
    // 模拟滑动续期：lastActivity 新，iat 仍为首次登录
    const renewed = await createSessionToken(nearExpiry, iatSec);
    expect(await verifySessionToken(renewed, nearExpiry)).not.toBeNull();

    const pastAbsolute = new Date(
      issuedAt.getTime() + SESSION_ABSOLUTE_MAX + 1000,
    );
    expect(await verifySessionToken(renewed, pastAbsolute)).toBeNull();
    expect(await touchSessionToken(renewed, pastAbsolute)).toBeNull();
  });

  it("rejects tokens without iat as expired", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = await signWithoutIat(nowSec);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects idle-expired sessions within absolute max", async () => {
    const issuedAt = new Date("2025-01-01T00:00:00.000Z");
    const token = await createSessionToken(issuedAt);
    const afterIdle = new Date(issuedAt.getTime() + SESSION_IDLE_MS + 1000);
    expect(await verifySessionToken(token, afterIdle)).toBeNull();
  });
});
