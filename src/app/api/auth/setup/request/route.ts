import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { matchesOwnerEmail } from "@/lib/owner-email";
import { assertSameOrigin } from "@/lib/origin";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { createAuthOtpClient } from "@/lib/supabase/auth-otp";
import { setupRequestSchema } from "@/lib/validation";
import { getWebAuthnOrigin } from "@/lib/env";

/**
 * POST /api/auth/setup/request
 * 提交邮箱；仅当匹配 OWNER_EMAIL 时发送魔法链接。
 * 始终返回同一中性响应，避免枚举。按 IP 限流。
 */

const NEUTRAL = {
  ok: true as const,
  message: "若该邮箱获准，登录链接已发送",
};

export async function POST(request: Request) {
  await requireRequest();
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }

  const ip = clientIp(request);
  const limited = checkRateLimit(`setup-request:${ip}`, 5, 60 * 60 * 1000);
  if (!limited.allowed) {
    return jsonError(429, "rate limit exceeded");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = setupRequestSchema.safeParse(body);
  if (!parsed.success) {
    // 格式错误可 400；匹配与否仍不泄露
    return jsonError(400, "invalid body");
  }

  const email = parsed.data.email.trim();
  if (matchesOwnerEmail(email)) {
    try {
      const supabase = createAuthOtpClient();
      const redirectTo = `${getWebAuthnOrigin()}/setup/confirm`;
      await supabase.auth.signInWithOtp({
        email: email.toLowerCase(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
        },
      });
    } catch {
      // 发送失败仍返回中性成功，避免泄露
    }
  }

  return jsonOk(NEUTRAL);
}
