import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SETUP_GRANT_TTL_MS,
  createSetupGrantToken,
  verifySetupGrantToken,
} from "@/lib/setup-grant";

const SECRET = "test-session-secret-at-least-32-chars!!";
const OWNER = "owner@example.com";

describe("setup grant JWT", () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });

  afterEach(() => {
    delete process.env.SESSION_SECRET;
  });

  it("accepts a fresh grant and rejects an expired one", async () => {
    const issuedAt = new Date("2025-01-01T00:00:00.000Z");
    const token = await createSetupGrantToken(issuedAt);
    expect(await verifySetupGrantToken(token, issuedAt)).toBe(true);

    const stillValid = new Date(issuedAt.getTime() + SETUP_GRANT_TTL_MS - 1000);
    expect(await verifySetupGrantToken(token, stillValid)).toBe(true);

    const expired = new Date(issuedAt.getTime() + SETUP_GRANT_TTL_MS + 1000);
    expect(await verifySetupGrantToken(token, expired)).toBe(false);
  });
});

describe("setup request neutral response", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SESSION_SECRET = SECRET;
    process.env.OWNER_EMAIL = OWNER;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  afterEach(() => {
    vi.resetModules();
    delete process.env.OWNER_EMAIL;
  });

  it("returns the same neutral body for matching and non-matching emails", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ data: {}, error: null });
    vi.doMock("@/lib/supabase/auth-otp", () => ({
      createAuthOtpClient: () => ({
        auth: { signInWithOtp },
      }),
    }));
    vi.doMock("@/lib/rate-limit", () => ({
      checkRateLimit: () => ({
        allowed: true,
        remaining: 4,
        retryAfterSeconds: 3600,
      }),
    }));

    const { POST } = await import("@/app/api/auth/setup/request/route");

    const matching = await POST(
      new Request("http://localhost/api/auth/setup/request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({ email: "Owner@Example.com" }),
      }),
    );
    const wrong = await POST(
      new Request("http://localhost/api/auth/setup/request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({ email: "other@example.com" }),
      }),
    );

    expect(matching.status).toBe(200);
    expect(wrong.status).toBe(200);
    const matchingBody = await matching.json();
    const wrongBody = await wrong.json();
    expect(matchingBody).toEqual(wrongBody);
    expect(matchingBody.message).toBe("若该邮箱获准，登录链接已发送");
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(signInWithOtp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: OWNER,
        options: expect.objectContaining({ shouldCreateUser: false }),
      }),
    );
  });
});

describe("register verify requires grant for bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = SECRET;
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it("rejects bootstrap verify when setup grant is missing or expired", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        challenge: "chal",
        purpose: "register",
        authorized: true,
        registration_mode: "bootstrap",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    });

    vi.doMock("@/lib/setup-grant", () => ({
      hasValidSetupGrant: async () => false,
      SETUP_GRANT_COOKIE_NAME: "xjg_setup_grant",
      clearedSetupGrantCookieOptions: () => ({ maxAge: 0 }),
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle }),
              }),
            }),
          }),
        }),
        rpc: vi.fn(),
      }),
    }));

    vi.doMock("@/lib/webauthn", () => ({
      verifyRegistrationAttestation: vi.fn(),
      encodePublicKey: () => "pk",
    }));

    const { POST } = await import("@/app/api/auth/register/verify/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge_id: "11111111-1111-4111-8111-111111111111",
          attestation: { id: "cred-1" },
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
