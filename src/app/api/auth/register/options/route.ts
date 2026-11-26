import { z } from "zod";
import { hashAgentToken, safeEqualHex } from "@/lib/crypto";
import { jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import {
  buildRegistrationOptions,
  type StoredCredential,
} from "@/lib/webauthn";

const bodySchema = z.object({
  one_time_token: z.string().optional(),
});

/**
 * POST /api/auth/register/options
 * - 首次：webauthn_registration.open = true
 * - 之后：需一次性登记令牌（哈希比对）
 */
export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const supabase = getServiceClient();
  const { data: reg } = await supabase
    .from("webauthn_registration")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (!reg) {
    return jsonError(503, "registration unavailable");
  }

  const { data: existing } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, public_key, counter, transports");

  const hasCredentials = (existing?.length ?? 0) > 0;

  if (!reg.open || hasCredentials) {
    const token = parsed.data.one_time_token;
    if (!token || !reg.one_time_token_hash) {
      return jsonError(403, "registration closed");
    }
    if (
      reg.one_time_token_expires_at &&
      new Date(reg.one_time_token_expires_at).getTime() < Date.now()
    ) {
      return jsonError(403, "registration token expired");
    }
    if (!safeEqualHex(hashAgentToken(token), reg.one_time_token_hash)) {
      return jsonError(403, "invalid registration token");
    }
  }

  const options = await buildRegistrationOptions(
    (existing ?? []) as StoredCredential[],
  );

  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { data: challengeRow, error } = await supabase
    .from("webauthn_challenges")
    .insert({
      challenge: options.challenge,
      purpose: "register",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !challengeRow) {
    return jsonError(500, "unavailable");
  }

  return jsonOk({ challenge_id: challengeRow.id, options });
}
