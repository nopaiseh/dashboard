import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashAgentToken } from "@/lib/crypto";

/**
 * 接口级：首次登记须 setup-grant；无 grant 拒绝；有凭据后 bootstrap 失效。
 */
describe("registration API rules", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it("rejects register options without setup grant or invite token", async () => {
    const rpc = vi.fn().mockImplementation((name: string) => {
      if (name === "rate_limit_register_options") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    vi.doMock("@/lib/setup-grant", () => ({
      hasValidSetupGrant: async () => false,
    }));

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
    expect(rpc).toHaveBeenCalledWith(
      "rate_limit_register_options",
      expect.anything(),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "authorize_and_create_registration_challenge",
      expect.anything(),
    );
  });

  it("authorizes bootstrap via setup grant when no credentials", async () => {
    const rpc = vi.fn().mockImplementation((name: string) => {
      if (name === "rate_limit_register_options") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({
        data: "11111111-1111-4111-8111-111111111111",
        error: null,
      });
    });

    vi.doMock("@/lib/setup-grant", () => ({
      hasValidSetupGrant: async () => true,
    }));

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
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(
      "authorize_and_create_registration_challenge",
      expect.objectContaining({
        p_mode: "bootstrap",
        p_token_hash: hashAgentToken("setup-grant"),
        p_challenge: "chal-bootstrap",
      }),
    );
  });

  it("rejects bootstrap grant path when any credential already exists", async () => {
    const rpc = vi.fn().mockImplementation((name: string) => {
      if (name === "rate_limit_register_options") {
        return Promise.resolve({ data: true, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });

    vi.doMock("@/lib/setup-grant", () => ({
      hasValidSetupGrant: async () => true,
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () =>
            Promise.resolve({
              data: [
                {
                  credential_id: "existing",
                  public_key: "pk",
                  counter: 0,
                  transports: [],
                },
              ],
              error: null,
            }),
        }),
        rpc,
      }),
    }));

    vi.doMock("@/lib/webauthn", () => ({
      buildRegistrationOptions: async () => ({
        challenge: "chal-existing",
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
    expect(rpc).not.toHaveBeenCalledWith(
      "authorize_and_create_registration_challenge",
      expect.anything(),
    );
  });
});
