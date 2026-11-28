import { beforeEach, describe, expect, it, vi } from "vitest";

describe("register verify API", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it("rejects invalid body", async () => {
    const { POST } = await import("@/app/api/auth/register/verify/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge_id: "not-uuid" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects leftover bootstrap challenges", async () => {
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

  it("completes via RPC after attestation succeeds (invite)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        challenge: "chal",
        purpose: "register",
        authorized: true,
        registration_mode: "invite",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    });

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
            id: "cred-1",
            publicKey: new Uint8Array([1, 2, 3]),
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
          challenge_id: "11111111-1111-4111-8111-111111111111",
          attestation: { id: "cred-1" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "complete_webauthn_registration",
      expect.objectContaining({
        p_challenge_id: "11111111-1111-4111-8111-111111111111",
        p_credential_id: "cred-1",
      }),
    );
  });
});
