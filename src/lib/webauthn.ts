import "server-only";

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import {
  getWebAuthnOrigin,
  getWebAuthnRpID,
  getWebAuthnRpName,
} from "@/lib/env";

/**
 * 仅允许 ES256 / RS256。
 * SimpleWebAuthn 14 在 Node≥24.7 默认会把 ML-DSA-44 (-48) 排在首位，
 * Proton Pass 等会按该 alg 登记，随后 navigator.credentials.get 失败。
 */
export const REGISTRATION_SUPPORTED_ALGORITHM_IDS = [-7, -257] as const;

export interface StoredCredential {
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string[];
}

export function rpConfig() {
  return {
    rpID: getWebAuthnRpID(),
    rpName: getWebAuthnRpName(),
    origin: getWebAuthnOrigin(),
  };
}

export async function buildLoginOptions(credentials: StoredCredential[]) {
  const { rpID } = rpConfig();
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: credentials.map((c) => ({
      id: c.credential_id,
      transports: c.transports as AuthenticatorTransport[],
    })),
    userVerification: "required",
  });
}

export async function buildRegistrationOptions(
  existing: StoredCredential[],
) {
  const { rpID, rpName } = rpConfig();
  return generateRegistrationOptions({
    rpID,
    rpName,
    userName: "owner",
    userDisplayName: "本人",
    excludeCredentials: existing.map((c) => ({
      id: c.credential_id,
      transports: c.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    attestationType: "none",
    supportedAlgorithmIDs: [...REGISTRATION_SUPPORTED_ALGORITHM_IDS],
  });
}

export async function verifyLoginAssertion(
  response: unknown,
  expectedChallenge: string,
  credential: StoredCredential,
): Promise<VerifiedAuthenticationResponse> {
  const { rpID, origin } = rpConfig();
  return verifyAuthenticationResponse({
    response: response as Parameters<
      typeof verifyAuthenticationResponse
    >[0]["response"],
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credential.credential_id,
      publicKey: Buffer.from(credential.public_key, "base64url"),
      counter: credential.counter,
      transports: credential.transports as AuthenticatorTransport[],
    },
    requireUserVerification: true,
  });
}

export async function verifyRegistrationAttestation(
  response: unknown,
  expectedChallenge: string,
): Promise<VerifiedRegistrationResponse> {
  const { rpID, origin } = rpConfig();
  return verifyRegistrationResponse({
    response: response as Parameters<
      typeof verifyRegistrationResponse
    >[0]["response"],
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true,
    supportedAlgorithmIDs: [...REGISTRATION_SUPPORTED_ALGORITHM_IDS],
  });
}

export function encodePublicKey(publicKey: Uint8Array): string {
  return Buffer.from(publicKey).toString("base64url");
}
