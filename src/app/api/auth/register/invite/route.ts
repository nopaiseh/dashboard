import { randomBytes } from "node:crypto";
import { requireSession } from "@/lib/auth-guard";
import { claimChallenge } from "@/lib/challenges";
import { hashAgentToken } from "@/lib/crypto";
import { jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { getServiceClient } from "@/lib/supabase/server";
import { inviteSchema } from "@/lib/validation";
import { verifyLoginAssertion, type StoredCredential } from "@/lib/webauthn";

const INVITE_TTL_MS = 15 * 60 * 1000;

/**
 * POST /api/auth/register/invite
 * 需已登录 + 现场 passkey（login 挑战抢占）；签发短时效一次性登记令牌。
 */
export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }

  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const supabase = getServiceClient();
  const challenge = await claimChallenge(
    supabase,
    parsed.data.challenge_id,
    "login",
  );
  if (!challenge) {
    return jsonError(400, "invalid challenge");
  }

  const assertion = parsed.data.assertion as { id?: string };
  const credentialId = assertion?.id;
  if (!credentialId) {
    return jsonError(400, "assertion missing credential id");
  }

  const { data: credential } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (!credential) {
    return jsonError(401, "unknown credential");
  }

  let verification;
  try {
    verification = await verifyLoginAssertion(
      parsed.data.assertion,
      challenge.challenge,
      credential as StoredCredential,
    );
  } catch {
    return jsonError(401, "passkey verification failed");
  }

  if (!verification.verified) {
    return jsonError(401, "passkey verification failed");
  }

  await supabase
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq("credential_id", credentialId);

  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashAgentToken(rawToken);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  const { error } = await supabase.rpc("set_registration_one_time_token", {
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  });

  if (error) {
    return jsonError(500, "failed to issue invite");
  }

  return jsonOk({
    token: rawToken,
    expires_at: expiresAt,
  });
}
