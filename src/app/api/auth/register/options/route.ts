import { hashAgentToken, safeEqualHex } from "@/lib/crypto";
import { getBootstrapToken } from "@/lib/env";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import { registerOptionsSchema } from "@/lib/validation";
import {
  buildRegistrationOptions,
  type StoredCredential,
} from "@/lib/webauthn";

/**
 * POST /api/auth/register/options
 * 无令牌一律拒绝。首次用 BOOTSTRAP_TOKEN；之后用新设备一次性令牌。
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

  let mode: "bootstrap" | "one_time" | null = null;
  try {
    const bootstrap = getBootstrapToken();
    if (safeEqualHex(tokenHash, hashAgentToken(bootstrap))) {
      mode = "bootstrap";
    }
  } catch {
    // BOOTSTRAP_TOKEN 未配置时只能走 one_time
  }

  if (!mode) {
    mode = "one_time";
  }

  const supabase = getServiceClient();
  const { data: existing } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, public_key, counter, transports");

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
