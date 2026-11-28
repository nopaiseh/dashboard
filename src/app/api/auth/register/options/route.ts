import { hashAgentToken } from "@/lib/crypto";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import { registerOptionsSchema } from "@/lib/validation";
import {
  buildRegistrationOptions,
  type StoredCredential,
} from "@/lib/webauthn";
import { requireRequest } from "@/lib/require-request";

/**
 * POST /api/auth/register/options
 * 新设备：须带 invite 一次性令牌（one_time）。无公开 bootstrap。
 * 按 IP 数据库限流。
 */

export async function POST(request: Request) {
  await requireRequest();
  const ip = clientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = registerOptionsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(403, "registration denied");
  }

  const supabase = getServiceClient();

  const { data: allowed, error: rateError } = await supabase.rpc(
    "rate_limit_register_options",
    {
      p_scope_key: ip,
      p_limit: 20,
      p_window_seconds: 60,
    },
  );
  if (rateError) {
    return jsonError(500, "unavailable");
  }
  if (!allowed) {
    return jsonError(429, "rate limit exceeded");
  }

  const { data: existing, error: credError } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, public_key, counter, transports");

  if (credError) {
    return jsonError(500, "unavailable");
  }

  const tokenHash = hashAgentToken(parsed.data.token);
  const options = await buildRegistrationOptions(
    (existing ?? []) as StoredCredential[],
  );

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { data: challengeId, error } = await supabase.rpc(
    "authorize_and_create_registration_challenge",
    {
      p_challenge: options.challenge,
      p_expires_at: expiresAt,
      p_token_hash: tokenHash,
      p_mode: "one_time",
    },
  );

  if (error || !challengeId) {
    return jsonError(403, "registration denied");
  }

  return jsonOk({ challenge_id: challengeId, options });
}
