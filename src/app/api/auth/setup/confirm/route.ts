import { NextResponse } from "next/server";
import { clientIp, jsonError } from "@/lib/http";
import { matchesOwnerEmail } from "@/lib/owner-email";
import { assertSameOrigin } from "@/lib/origin";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import {
  SETUP_GRANT_COOKIE_NAME,
  SETUP_GRANT_TTL_MS,
  createSetupGrantToken,
  setupGrantCookieOptions,
} from "@/lib/setup-grant";
import { createAuthOtpClient } from "@/lib/supabase/auth-otp";
import { setupConfirmSchema } from "@/lib/validation";
import { hasWebAuthnCredential } from "@/lib/webauthn-credentials";

/**
 * POST /api/auth/setup/confirm
 * 校验邮件 token_hash（须由用户点击按钮触发，避免预览消费）。
 * 成功后签发短时 setup-grant cookie；丢弃 Supabase Auth 会话。
 * 按 IP 进程内限流（见 rate-limit.ts）；响应非中性，不加时序填充。
 */

export async function POST(request: Request) {
  await requireRequest();
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }

  const ip = clientIp(request);
  const limited = checkRateLimit(`setup-confirm:${ip}`, 20, 60 * 60 * 1000);
  if (!limited.allowed) {
    return jsonError(429, "rate limit exceeded");
  }

  if (await hasWebAuthnCredential()) {
    return jsonError(403, "registration closed");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = setupConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const { token_hash, type } = parsed.data;
  const supabase = createAuthOtpClient();

  try {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });
    if (error) {
      return jsonError(400, "invalid or expired link");
    }
    if (!matchesOwnerEmail(data.user?.email ?? "")) {
      return jsonError(400, "invalid or expired link");
    }
  } catch {
    return jsonError(400, "invalid or expired link");
  } finally {
    // 丢弃 verifyOtp 产生的 Auth 会话；本站只用 setup-grant
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignore
    }
  }

  const grant = await createSetupGrantToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SETUP_GRANT_COOKIE_NAME,
    grant,
    setupGrantCookieOptions(Math.floor(SETUP_GRANT_TTL_MS / 1000)),
  );
  return response;
}
