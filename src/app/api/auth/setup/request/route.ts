import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { matchesOwnerEmail } from "@/lib/owner-email";
import { assertSameOrigin } from "@/lib/origin";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { createAuthOtpClient } from "@/lib/supabase/auth-otp";
import { ensureMinDuration } from "@/lib/timing";
import { setupRequestSchema } from "@/lib/validation";
import { getWebAuthnOrigin } from "@/lib/env";

/**
 * POST /api/auth/setup/request
 * 提交邮箱；仅当匹配 OWNER_EMAIL 时发送魔法链接。
 * 始终返回同一中性响应，避免枚举。按 IP 限流（进程内，见 rate-limit.ts）。
 * 对匹配/非匹配路径做 ~400ms 最短响应时间填充，缩小时序差。
 *
 * 注：confirm 返回按成败区分的状态码/文案，时序填充无法隐藏结果，故不加下限。
 */

const NEUTRAL = {
  ok: true as const,
  message: "若该邮箱获准，登录链接已发送",
};

/** 压缩匹配与否的时序差（OTP 网络往返通常远长于此；仅作下限）。 */
const MIN_RESPONSE_MS = 400;

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
    return jsonError(400, "invalid body");
  }

  const email = parsed.data.email.trim();
  const started = Date.now();

  if (matchesOwnerEmail(email)) {
    try {
      const supabase = createAuthOtpClient();
      const redirectTo = `${getWebAuthnOrigin()}/setup/confirm`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.toLowerCase(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: redirectTo,
        },
      });
      if (error) {
        console.error(
          "[setup/request] signInWithOtp failed:",
          error.message,
        );
      }
    } catch (err) {
      console.error("[setup/request] signInWithOtp threw:", err);
    }
  }

  await ensureMinDuration(started, MIN_RESPONSE_MS);
  return jsonOk(NEUTRAL);
}
