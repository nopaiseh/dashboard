import { beforeEach, describe, expect, it, vi } from "vitest";

describe("buildRegistrationOptions residentKey", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.WEBAUTHN_RP_ID = "desk.nopaiseh.com";
    process.env.WEBAUTHN_RP_NAME = "玄机阁";
    process.env.WEBAUTHN_ORIGIN = "https://desk.nopaiseh.com";
  });

  it("requires discoverable credentials (residentKey required)", async () => {
    const generateRegistrationOptions = vi.fn().mockResolvedValue({
      challenge: "chal",
      rp: { name: "玄机阁", id: "desk.nopaiseh.com" },
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
    });

    vi.doMock("@simplewebauthn/server", () => ({
      generateRegistrationOptions,
      generateAuthenticationOptions: vi.fn(),
      verifyAuthenticationResponse: vi.fn(),
      verifyRegistrationResponse: vi.fn(),
    }));

    const { buildRegistrationOptions } = await import("@/lib/webauthn");
    await buildRegistrationOptions([]);

    expect(generateRegistrationOptions).toHaveBeenCalledTimes(1);
    const arg = generateRegistrationOptions.mock.calls[0][0] as {
      authenticatorSelection: {
        residentKey: string;
        requireResidentKey?: boolean;
        userVerification: string;
      };
    };
    expect(arg.authenticatorSelection.residentKey).toBe("required");
    expect(arg.authenticatorSelection.userVerification).toBe("required");
    // requireResidentKey 未显式传入时由 SimpleWebAuthn 与 residentKey 对齐
    expect(arg.authenticatorSelection.requireResidentKey).toBeUndefined();
  });
});
