import { beforeEach, describe, expect, it, vi } from "vitest";

describe("hasWebAuthnCredential", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  });

  it("returns false when no rows exist", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () =>
            Promise.resolve({ count: 0, error: null, data: null }),
        }),
      }),
    }));

    const { hasWebAuthnCredential } = await import(
      "@/lib/webauthn-credentials"
    );
    expect(await hasWebAuthnCredential()).toBe(false);
  });

  it("returns true when at least one credential exists", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () =>
            Promise.resolve({ count: 1, error: null, data: null }),
        }),
      }),
    }));

    const { hasWebAuthnCredential } = await import(
      "@/lib/webauthn-credentials"
    );
    expect(await hasWebAuthnCredential()).toBe(true);
  });

  it("fail-closes to true on query error (no leak of details)", async () => {
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () =>
            Promise.resolve({
              count: null,
              error: { message: "db down" },
              data: null,
            }),
        }),
      }),
    }));

    const { hasWebAuthnCredential } = await import(
      "@/lib/webauthn-credentials"
    );
    expect(await hasWebAuthnCredential()).toBe(true);
  });
});
