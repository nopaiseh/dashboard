import { requireSession } from "@/lib/auth-guard";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import {
  assertNotLocked,
} from "@/lib/login-service";
import { getServiceClient } from "@/lib/supabase/server";
import { stepUpOptionsSchema } from "@/lib/validation";
import { buildLoginOptions, type StoredCredential } from "@/lib/webauthn";

/**
 * GET /api/auth/options — 登录断言选项；库内按 IP 限流并清理过期挑战。
 */
export async function GET(request: Request) {
  await requireRequest();
  const ip = clientIp(request);
  const supabase = getServiceClient();

  const { data: allowed, error: rateError } = await supabase.rpc(
    "rate_limit_auth_options",
    {
      p_scope_key: ip,
      p_limit: 30,
      p_window_seconds: 60,
    },
  );
  if (rateError) {
    return jsonError(500, "unavailable");
  }
  if (!allowed) {
    return jsonError(429, "rate limit exceeded");
  }

  const lock = await assertNotLocked(supabase, ip);
  if (!lock.ok) {
    return jsonError(429, lock.error);
  }

  const { data: credentials, error } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, public_key, counter, transports");

  if (error) {
    return jsonError(500, "unavailable");
  }

  if (!credentials || credentials.length === 0) {
    return jsonError(503, "login unavailable");
  }

  const options = await buildLoginOptions(credentials as StoredCredential[]);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: challengeRow, error: challengeError } = await supabase
    .from("webauthn_challenges")
    .insert({
      challenge: options.challenge,
      purpose: "login",
      expires_at: expiresAt,
      authorized: false,
    })
    .select("id")
    .single();

  if (challengeError || !challengeRow) {
    return jsonError(500, "unavailable");
  }

  return jsonOk({
    challenge_id: challengeRow.id,
    options,
  });
}

/**
 * POST /api/auth/options — step-up（需登录 + Origin）。
 */
export async function POST(request: Request) {
  await requireRequest();
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

  const parsed = stepUpOptionsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const supabase = getServiceClient();
  const { data: credentials, error } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, public_key, counter, transports");

  if (error || !credentials?.length) {
    return jsonError(503, "login unavailable");
  }

  const options = await buildLoginOptions(credentials as StoredCredential[]);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: challengeRow, error: challengeError } = await supabase
    .from("webauthn_challenges")
    .insert({
      challenge: options.challenge,
      purpose: "step_up",
      item_id: parsed.data.item_id,
      expires_at: expiresAt,
      authorized: false,
    })
    .select("id")
    .single();

  if (challengeError || !challengeRow) {
    return jsonError(500, "unavailable");
  }

  return jsonOk({
    challenge_id: challengeRow.id,
    options,
  });
}
import { requireRequest } from "@/lib/require-request";
