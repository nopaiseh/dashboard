import { clientIp, jsonError, jsonOk } from "@/lib/http";
import {
  assertNotLocked,
  recordLoginFailure,
} from "@/lib/login-service";
import { getServiceClient } from "@/lib/supabase/server";
import { buildLoginOptions, type StoredCredential } from "@/lib/webauthn";

/**
 * GET /api/auth/options — 登录用 passkey 断言选项。
 * 不透露站名以外的敏感信息；无凭证时返回通用错误。
 */
export async function GET(request: Request) {
  const ip = clientIp(request);
  const supabase = getServiceClient();

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
    // 不暴露「尚未登记」细节给未认证访客时可统一文案
    return jsonError(503, "login unavailable");
  }

  const options = await buildLoginOptions(
    credentials as StoredCredential[],
  );

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: challengeRow, error: challengeError } = await supabase
    .from("webauthn_challenges")
    .insert({
      challenge: options.challenge,
      purpose: "login",
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (challengeError || !challengeRow) {
    await recordLoginFailure(supabase, ip);
    return jsonError(500, "unavailable");
  }

  return jsonOk({
    challenge_id: challengeRow.id,
    options,
  });
}

/**
 * POST /api/auth/options — step-up 断言选项（须已登录会话）。
 * body: { purpose: 'step_up', item_id: uuid }
 */
export async function POST(request: Request) {
  const { requireSession } = await import("@/lib/auth-guard");
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  let body: { purpose?: string; item_id?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonError(400, "invalid json");
  }

  if (body.purpose !== "step_up" || !body.item_id) {
    return jsonError(400, "invalid body");
  }

  const supabase = getServiceClient();
  const { data: credentials, error } = await supabase
    .from("webauthn_credentials")
    .select("credential_id, public_key, counter, transports");

  if (error || !credentials?.length) {
    return jsonError(503, "login unavailable");
  }

  const options = await buildLoginOptions(
    credentials as StoredCredential[],
  );
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const { data: challengeRow, error: challengeError } = await supabase
    .from("webauthn_challenges")
    .insert({
      challenge: options.challenge,
      purpose: "step_up",
      item_id: body.item_id,
      expires_at: expiresAt,
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
