import { beforeEach, describe, expect, it, vi } from "vitest";

describe("auth verify fail-closed lockout response", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it("returns 429 when recordLoginFailure reports locked", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => {},
    }));
    vi.doMock("@/lib/login-service", () => ({
      assertNotLocked: async () => ({ ok: true }),
      recordLoginFailure: async () => ({ locked: true }),
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
          assertion: { id: "cred-1" },
        }),
      }),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("locked");
  });

  it("returns 401 when failure is recorded but not yet locked", async () => {
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
          assertion: { id: "cred-1" },
        }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
