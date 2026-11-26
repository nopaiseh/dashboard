import { beforeEach, describe, expect, it, vi } from "vitest";

describe("cookie POST origin + invite gate", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  });

  it("rejects invite without matching Origin", async () => {
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));

    const { POST } = await import("@/app/api/auth/register/invite/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/auth/register/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({
          challenge_id: "11111111-1111-4111-8111-111111111111",
          assertion: {},
        }),
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/origin/i);
  });

  it("rejects invite when unauthenticated", async () => {
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({
        ok: false,
        status: 401,
        error: "unauthorized",
      }),
    }));

    const { POST } = await import("@/app/api/auth/register/invite/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/auth/register/invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          challenge_id: "11111111-1111-4111-8111-111111111111",
          assertion: {},
        }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
