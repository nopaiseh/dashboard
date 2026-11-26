import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
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
 * 成功后签发短时 setup-grant cookie。
 */

export async function POST(request: Request) {
  await requireRequest();
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
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

  try {
    const supabase = createAuthOtpClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type,
    });
    if (error) {
      return jsonError(400, "invalid or expired link");
    }
  } catch {
    return jsonError(400, "invalid or expired link");
  }

  // 验证通过后不保留 Supabase Auth 会话；只发本站 setup grant
  const grant = await createSetupGrantToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(
    SETUP_GRANT_COOKIE_NAME,
    grant,
    setupGrantCookieOptions(Math.floor(SETUP_GRANT_TTL_MS / 1000)),
  );
  return response;
}
