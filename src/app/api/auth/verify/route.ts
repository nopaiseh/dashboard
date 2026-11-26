import { NextResponse } from "next/server";
import { claimChallenge } from "@/lib/challenges";
import { clientIp, jsonError } from "@/lib/http";
import {
  assertNotLocked,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-service";
import { assertSameOrigin } from "@/lib/origin";
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MS,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/session";
import { getServiceClient } from "@/lib/supabase/server";
import { authVerifySchema } from "@/lib/validation";
import { verifyLoginAssertion, type StoredCredential } from "@/lib/webauthn";
import { requireRequest } from "@/lib/require-request";

async function rejectFailure(
  supabase: ReturnType<typeof getServiceClient>,
  ip: string,
  credentialId?: string | null,
) {
  const failure = await recordLoginFailure(supabase, ip, credentialId);
  if (failure.locked) {
    return jsonError(429, "locked: too many failed login attempts");
  }
  return jsonError(401, "authentication failed");
}

export async function POST(request: Request) {
  await requireRequest();
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }

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

  const parsed = authVerifySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const challengeRow = await claimChallenge(
    supabase,
    parsed.data.challenge_id,
    "login",
  );
  if (!challengeRow) {
    return rejectFailure(supabase, ip);
  }

  const assertion = parsed.data.assertion as { id?: string };
  const credentialId = assertion?.id;
  if (!credentialId) {
    return rejectFailure(supabase, ip);
  }

  const credLock = await assertNotLocked(supabase, ip, credentialId);
  if (!credLock.ok) {
    return jsonError(429, credLock.error);
  }

  const { data: credential } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (!credential) {
    return rejectFailure(supabase, ip, credentialId);
  }

  let verification;
  try {
    verification = await verifyLoginAssertion(
      parsed.data.assertion,
      challengeRow.challenge,
      credential as StoredCredential,
    );
  } catch {
    return rejectFailure(supabase, ip, credentialId);
  }

  if (!verification.verified) {
    return rejectFailure(supabase, ip, credentialId);
  }

  await supabase
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq("credential_id", credentialId);

  await recordLoginSuccess(supabase, ip, credentialId);

  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SESSION_COOKIE_NAME,
    token,
    sessionCookieOptions(Math.floor(SESSION_IDLE_MS / 1000)),
  );
  return response;
}
