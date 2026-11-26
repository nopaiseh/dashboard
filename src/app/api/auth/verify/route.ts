import { z } from "zod";
import { clientIp, jsonError } from "@/lib/http";
import {
  assertNotLocked,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-service";
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MS,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";
import { getServiceClient } from "@/lib/supabase/server";
import { verifyLoginAssertion, type StoredCredential } from "@/lib/webauthn";
import { NextResponse } from "next/server";

const verifySchema = z.object({
  challenge_id: z.string().uuid(),
  assertion: z.unknown(),
});

/**
 * POST /api/auth/verify — 校验 passkey 断言并签发会话 cookie。
 */
export async function POST(request: Request) {
  const ip = clientIp(request);
  const supabase = getServiceClient();

  const lock = await assertNotLocked(supabase, ip);
  if (!lock.ok) {
    return jsonError(429, lock.error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const { data: challengeRow } = await supabase
    .from("webauthn_challenges")
    .select("*")
    .eq("id", parsed.data.challenge_id)
    .eq("purpose", "login")
    .maybeSingle();

  if (!challengeRow) {
    await recordLoginFailure(supabase, ip);
    return jsonError(401, "authentication failed");
  }
  if (new Date(challengeRow.expires_at).getTime() < Date.now()) {
    await recordLoginFailure(supabase, ip);
    return jsonError(401, "authentication failed");
  }

  const assertion = parsed.data.assertion as { id?: string };
  const credentialId = assertion?.id;
  if (!credentialId) {
    await recordLoginFailure(supabase, ip);
    return jsonError(401, "authentication failed");
  }

  const { data: credential } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (!credential) {
    await recordLoginFailure(supabase, ip);
    return jsonError(401, "authentication failed");
  }

  let verification;
  try {
    verification = await verifyLoginAssertion(
      parsed.data.assertion,
      challengeRow.challenge,
      credential as StoredCredential,
    );
  } catch {
    await recordLoginFailure(supabase, ip);
    return jsonError(401, "authentication failed");
  }

  if (!verification.verified) {
    await recordLoginFailure(supabase, ip);
    return jsonError(401, "authentication failed");
  }

  await supabase
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq("credential_id", credentialId);

  await supabase
    .from("webauthn_challenges")
    .delete()
    .eq("id", parsed.data.challenge_id);

  await recordLoginSuccess(supabase, ip);

  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(Math.floor(SESSION_IDLE_MS / 1000)),
  );
  return response;
}
