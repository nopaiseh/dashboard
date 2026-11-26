import { describe, expect, it, vi, beforeEach } from "vitest";
import { hashAgentToken } from "@/lib/crypto";

/**
 * 接口级：注册无令牌拒绝；options 作废令牌并绑定挑战。
 */
describe("registration API rules", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.BOOTSTRAP_TOKEN = "bootstrap-secret-token";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it("rejects register options without token", async () => {
    const rpc = vi.fn();
    const from = vi.fn(() => ({
      select: () => ({
        then: undefined,
      }),
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => Promise.resolve({ data: [], error: null }),
        }),
        rpc,
      }),
    }));

    // Avoid real WebAuthn crypto: mock options builder
    vi.doMock("@/lib/webauthn", () => ({
      buildRegistrationOptions: async () => ({
        challenge: "chal",
        rp: { name: "x", id: "desk.nopaiseh.com" },
      }),
    }));

    const { POST } = await import("@/app/api/auth/register/options/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register/options", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    void from;
  });

  it("consumes bootstrap token via authorize RPC when token matches", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: "11111111-1111-4111-8111-111111111111",
      error: null,
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => Promise.resolve({ data: [], error: null }),
        }),
        rpc,
      }),
    }));

    vi.doMock("@/lib/webauthn", () => ({
      buildRegistrationOptions: async () => ({
        challenge: "chal-bootstrap",
        rp: { name: "x", id: "desk.nopaiseh.com" },
      }),
    }));

    const { POST } = await import("@/app/api/auth/register/options/route");
    const res = await POST(
      new Request("http://localhost/api/auth/register/options", {
        method: "POST",
        body: JSON.stringify({ token: "bootstrap-secret-token" }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "authorize_and_create_registration_challenge",
      expect.objectContaining({
        p_mode: "bootstrap",
        p_token_hash: hashAgentToken("bootstrap-secret-token"),
        p_challenge: "chal-bootstrap",
      }),
    );
  });
});
