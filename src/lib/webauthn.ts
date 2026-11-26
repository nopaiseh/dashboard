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
      residentKey: "preferred",
      userVerification: "required",
    },
    attestationType: "none",
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
  });
}

export function encodePublicKey(publicKey: Uint8Array): string {
  return Buffer.from(publicKey).toString("base64url");
}
