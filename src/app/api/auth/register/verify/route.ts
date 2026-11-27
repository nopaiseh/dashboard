import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import {
  SETUP_GRANT_COOKIE_NAME,
  clearedSetupGrantCookieOptions,
  consumeSetupGrantJti,
  readValidSetupGrantJti,
} from "@/lib/setup-grant";
import { getServiceClient } from "@/lib/supabase/server";
import { registerVerifySchema } from "@/lib/validation";
import {
  encodePublicKey,
  verifyRegistrationAttestation,
} from "@/lib/webauthn";
import { requireRequest } from "@/lib/require-request";

/**
 * POST /api/auth/register/verify
 * 校验 attestation 后由 RPC 在同一事务复查授权、写入凭据、关闭注册。
 * bootstrap（首次）挑战另须有效 setup-grant；成功后消费 jti 并清除 grant cookie。
 */

export async function POST(request: Request) {
  await requireRequest();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = registerVerifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const supabase = getServiceClient();

  const { data: preview } = await supabase
    .from("webauthn_challenges")
    .select("*")
    .eq("id", parsed.data.challenge_id)
    .eq("purpose", "register")
    .eq("authorized", true)
    .maybeSingle();

  if (!preview || new Date(preview.expires_at).getTime() < Date.now()) {
    return jsonError(400, "invalid challenge");
  }

  const isBootstrap = preview.registration_mode === "bootstrap";
  let grantJti: string | null = null;
  if (isBootstrap) {
    grantJti = await readValidSetupGrantJti();
    if (!grantJti) {
      return jsonError(403, "registration denied");
    }
  }

  let verification;
  try {
    verification = await verifyRegistrationAttestation(
      parsed.data.attestation,
      preview.challenge,
    );
  } catch {
    return jsonError(400, "registration failed");
  }

  if (!verification.verified || !verification.registrationInfo) {
    return jsonError(400, "registration failed");
  }

  const { credential } = verification.registrationInfo;

  const { error } = await supabase.rpc("complete_webauthn_registration", {
    p_challenge_id: parsed.data.challenge_id,
    p_credential_id: credential.id,
    p_public_key: encodePublicKey(credential.publicKey),
    p_counter: credential.counter,
    p_transports: credential.transports ?? [],
  });

  if (error) {
    return jsonError(403, "registration denied");
  }

  const response = NextResponse.json({
    ok: true,
    credential_id: credential.id,
  });
  if (isBootstrap && grantJti) {
    await consumeSetupGrantJti(grantJti);
    response.cookies.set(
      SETUP_GRANT_COOKIE_NAME,
      "",
      clearedSetupGrantCookieOptions(),
    );
  }
  return response;
}
