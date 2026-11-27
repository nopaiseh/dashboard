import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeContentHash } from "@/lib/content-hash";

describe("decision API", () => {
  const hash = computeContentHash({
    kind: "approval",
    title: "t",
    body: "b",
    options: [{ key: "yes", label: "Yes" }],
    source_url: null,
    due_at: null,
  });

  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it("returns 422 when item sensitive fields cannot be decrypted", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/challenges", () => ({
      claimChallenge: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        challenge: "chal",
        purpose: "step_up",
        item_id: "22222222-2222-4222-8222-222222222222",
        authorized: false,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    }));
    vi.doMock("@/lib/webauthn", () => ({
      verifyLoginAssertion: async () => ({
        verified: true,
        authenticationInfo: { newCounter: 2 },
      }),
    }));

    const { encryptItemSensitiveFields } = await import("@/lib/crypto/fields");
    const sealed = encryptItemSensitiveFields({
      id: "33333333-3333-4333-8333-333333333333",
      title: "t",
      body: "b",
      source_url: null,
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "22222222-2222-4222-8222-222222222222",
                  kind: "approval",
                  status: "open",
                  content_hash: hash,
                  options: [{ key: "yes", label: "Yes" }],
                  title: sealed.title,
                  body: sealed.body,
                  source_url: null,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }),
        rpc: vi.fn(),
      }),
    }));

    const { POST } = await import("@/app/api/items/[id]/decision/route");
    const res = await POST(
      new Request(
        "https://desk.nopaiseh.com/api/items/22222222-2222-4222-8222-222222222222/decision",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://desk.nopaiseh.com",
          },
          body: JSON.stringify({
            action: "approve",
            content_hash: hash,
            option_key: "yes",
            challenge_id: "11111111-1111-4111-8111-111111111111",
            assertion: { id: "cred" },
          }),
        },
      ),
      { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) },
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/could not be decrypted/i);
  });

  it("returns generic error without leaking DB message", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/challenges", () => ({
      claimChallenge: async () => ({
        id: "11111111-1111-4111-8111-111111111111",
        challenge: "chal",
        purpose: "step_up",
        item_id: "22222222-2222-4222-8222-222222222222",
        authorized: false,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    }));
    vi.doMock("@/lib/webauthn", () => ({
      verifyLoginAssertion: async () => ({
        verified: true,
        authenticationInfo: { newCounter: 2 },
      }),
    }));

    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "content_hash mismatch DETAIL: secret-table" },
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "22222222-2222-4222-8222-222222222222",
                  kind: "approval",
                  status: "open",
                  content_hash: hash,
                  options: [{ key: "yes", label: "Yes" }],
                },
                error: null,
              }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }),
        rpc,
      }),
    }));

    const { POST } = await import("@/app/api/items/[id]/decision/route");
    const res = await POST(
      new Request(
        "https://desk.nopaiseh.com/api/items/22222222-2222-4222-8222-222222222222/decision",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://desk.nopaiseh.com",
          },
          body: JSON.stringify({
            action: "approve",
            content_hash: hash,
            option_key: "yes",
            challenge_id: "11111111-1111-4111-8111-111111111111",
            assertion: { id: "cred" },
          }),
        },
      ),
      { params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }) },
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("decision failed");
    expect(body.error).not.toMatch(/secret-table|content_hash mismatch/i);
  });
});
