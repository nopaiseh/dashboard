import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 同一 bootstrap 令牌开出两个挑战时，第二次 complete 必须失败。
 * （SQL 层实跑见 sql-functions.test.ts；此处覆盖 API 对 RPC 冲突的映射。）
 */
describe("register verify dual challenge", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it("maps second bootstrap complete conflict to 403", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "XJ409", message: "bootstrap disabled: credentials already exist" },
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        challenge: "chal-b",
        purpose: "register",
        authorized: true,
        registration_mode: "bootstrap",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    });

    vi.doMock("@/lib/setup-grant", () => ({
      hasValidSetupGrant: async () => true,
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
        rpc,
      }),
    }));

    vi.doMock("@/lib/webauthn", () => ({
      verifyRegistrationAttestation: async () => ({
        verified: true,
        registrationInfo: {
          credential: {
            id: "cred-2",
            publicKey: new Uint8Array([1]),
            counter: 0,
            transports: [],
          },
        },
      }),
      encodePublicKey: () => "pk",
    }));

    const { POST } = await import("@/app/api/auth/register/verify/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          challenge_id: "22222222-2222-4222-8222-222222222222",
          attestation: { id: "cred-2" },
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});
