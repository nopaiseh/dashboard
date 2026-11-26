import { beforeEach, describe, expect, it, vi } from "vitest";

describe("buildRegistrationOptions", () => {
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
      supportedAlgorithmIDs: number[];
    };
    expect(arg.authenticatorSelection.residentKey).toBe("required");
    expect(arg.authenticatorSelection.userVerification).toBe("required");
    // requireResidentKey 未显式传入时由 SimpleWebAuthn 与 residentKey 对齐
    expect(arg.authenticatorSelection.requireResidentKey).toBeUndefined();
  });

  it("pins pubKeyCredParams algorithms to ES256 and RS256 only (no ML-DSA-44)", async () => {
    const generateRegistrationOptions = vi.fn().mockResolvedValue({
      challenge: "chal",
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
    });
    const verifyRegistrationResponse = vi.fn();

    vi.doMock("@simplewebauthn/server", () => ({
      generateRegistrationOptions,
      generateAuthenticationOptions: vi.fn(),
      verifyAuthenticationResponse: vi.fn(),
      verifyRegistrationResponse,
    }));

    const {
      buildRegistrationOptions,
      verifyRegistrationAttestation,
      REGISTRATION_SUPPORTED_ALGORITHM_IDS,
    } = await import("@/lib/webauthn");

    await buildRegistrationOptions([]);
    const genArg = generateRegistrationOptions.mock.calls[0][0] as {
      supportedAlgorithmIDs: number[];
    };
    expect(genArg.supportedAlgorithmIDs).toEqual([-7, -257]);
    expect(genArg.supportedAlgorithmIDs).toEqual([
      ...REGISTRATION_SUPPORTED_ALGORITHM_IDS,
    ]);
    expect(genArg.supportedAlgorithmIDs).not.toContain(-48);

    verifyRegistrationResponse.mockResolvedValue({ verified: false });
    await verifyRegistrationAttestation({ id: "x" }, "chal");
    const verifyArg = verifyRegistrationResponse.mock.calls[0][0] as {
      supportedAlgorithmIDs: number[];
    };
    expect(verifyArg.supportedAlgorithmIDs).toEqual([-7, -257]);
    expect(verifyArg.supportedAlgorithmIDs).not.toContain(-48);
  });

  it("returned options.pubKeyCredParams contain exactly -7 and -257", async () => {
    // 真实 SimpleWebAuthn（不 mock），断言输出 pubKeyCredParams
    const { buildRegistrationOptions } = await import("@/lib/webauthn");
    const options = await buildRegistrationOptions([]);
    const algs = options.pubKeyCredParams.map((p) => p.alg).sort((a, b) => a - b);
    expect(algs).toEqual([-257, -7]);
    expect(algs).not.toContain(-48);
    expect(options.pubKeyCredParams).toHaveLength(2);
  });
});