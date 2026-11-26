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
 * 校验通过后立即作废令牌，并将授权绑定到挑战码。
 */
export async function POST(request: Request) {
  void clientIp(request);

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

  const rawToken = parsed.data.token;
  const tokenHash = hashAgentToken(rawToken);

  const supabase = getServiceClient();
  const { data: existing, error: credError } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, public_key, counter, transports");

  if (credError) {
    return jsonError(500, "unavailable");
  }

  const hasCredentials = (existing?.length ?? 0) > 0;

  // 已有凭据时服务端直接禁止 bootstrap（RPC 内再查一遍）
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
