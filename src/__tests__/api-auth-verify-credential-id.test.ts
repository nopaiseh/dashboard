import { beforeEach, describe, expect, it, vi } from "vitest";
import { CREDENTIAL_ID_MAX } from "@/lib/validation";

describe("auth verify credential id length cap", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it(`returns 400 when assertion.id exceeds ${CREDENTIAL_ID_MAX} (before DB)`, async () => {
    const recordLoginFailure = vi.fn();
    const from = vi.fn();

    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => {},
    }));
    vi.doMock("@/lib/login-service", () => ({
      assertNotLocked: async () => ({ ok: true }),
      recordLoginFailure,
      recordLoginSuccess: async () => {},
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({ from }),
    }));

    const { POST } = await import("@/app/api/auth/verify/route");
    const res = await POST(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          challenge_id: "11111111-1111-4111-8111-111111111111",
          assertion: { id: "x".repeat(CREDENTIAL_ID_MAX + 1) },
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it(`accepts assertion.id of length ${CREDENTIAL_ID_MAX} at schema boundary`, async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => {},
    }));
    vi.doMock("@/lib/login-service", () => ({
      assertNotLocked: async () => ({ ok: true }),
      recordLoginFailure: async () => ({ locked: false }),
      recordLoginSuccess: async () => {},
    }));
    vi.doMock("@/lib/challenges", () => ({
      claimChallenge: async () => null,
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({}),
    }));

    const { POST } = await import("@/app/api/auth/verify/route");
    const res = await POST(
      new Request("http://localhost/api/auth/verify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          challenge_id: "11111111-1111-4111-8111-111111111111",
          assertion: { id: "y".repeat(CREDENTIAL_ID_MAX) },
        }),
      }),
    );

    // 长度合法 → 通过 zod，进入验签流程（challenge 抢占失败 → 401）
    expect(res.status).toBe(401);
  });
});
