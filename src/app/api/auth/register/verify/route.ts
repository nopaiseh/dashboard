import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import {
  encodePublicKey,
  verifyRegistrationAttestation,
} from "@/lib/webauthn";

const schema = z.object({
  challenge_id: z.string().uuid(),
  attestation: z.unknown(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const supabase = getServiceClient();
  const { data: challengeRow } = await supabase
    .from("webauthn_challenges")
    .select("*")
    .eq("id", parsed.data.challenge_id)
    .eq("purpose", "register")
    .maybeSingle();

  if (!challengeRow) {
    return jsonError(400, "invalid challenge");
  }
  if (new Date(challengeRow.expires_at).getTime() < Date.now()) {
    return jsonError(400, "challenge expired");
  }

  let verification;
  try {
    verification = await verifyRegistrationAttestation(
      parsed.data.attestation,
      challengeRow.challenge,
    );
  } catch {
    return jsonError(400, "registration failed");
  }

  if (!verification.verified || !verification.registrationInfo) {
    return jsonError(400, "registration failed");
  }

  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;

  void credentialDeviceType;
  void credentialBackedUp;

  const { error: insertError } = await supabase
    .from("webauthn_credentials")
    .insert({
      credential_id: credential.id,
      public_key: encodePublicKey(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
    });

  if (insertError) {
    return jsonError(500, "failed to store credential");
  }

  // 第一把登记后关闭开放登记；清空一次性令牌
  await supabase
    .from("webauthn_registration")
    .update({
      open: false,
      one_time_token_hash: null,
      one_time_token_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);

  await supabase
    .from("webauthn_challenges")
    .delete()
    .eq("id", parsed.data.challenge_id);

  return jsonOk({ ok: true, credential_id: credential.id });
}
