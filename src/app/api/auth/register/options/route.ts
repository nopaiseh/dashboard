import { matchesBootstrapToken } from "@/lib/bootstrap-token";
import { hashAgentToken } from "@/lib/crypto";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import { registerOptionsSchema } from "@/lib/validation";
import {
  buildRegistrationOptions,
  type StoredCredential,
} from "@/lib/webauthn";

/**
 * POST /api/auth/register/options
 * 无令牌一律拒绝。首次用合格 BOOTSTRAP_TOKEN；已有凭据后 bootstrap 失效。
 * 按 IP 数据库限流。
 */

export async function POST(request: Request) {
  await requireRequest();
  const ip = clientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = registerOptionsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(403, "registration token required");
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

  const rawToken = parsed.data.token;
  const tokenHash = hashAgentToken(rawToken);

  const { data: existing, error: credError } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, public_key, counter, transports");

  if (credError) {
    return jsonError(500, "unavailable");
  }

  const hasCredentials = (existing?.length ?? 0) > 0;

  let mode: "bootstrap" | "one_time" = "one_time";
  if (!hasCredentials && matchesBootstrapToken(rawToken)) {
    mode = "bootstrap";
  }

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
      p_mode: mode,
    },
  );

  if (error || !challengeId) {
    return jsonError(403, "registration denied");
  }

  return jsonOk({ challenge_id: challengeId, options });
}
import { requireRequest } from "@/lib/require-request";
