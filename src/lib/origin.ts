import { getWebAuthnOrigin } from "@/lib/env";

/** Cookie 认证的写操作必须带匹配的 Origin。 */
export function assertSameOrigin(
  request: Request,
): { ok: true } | { ok: false; error: string } {
  const expected = getWebAuthnOrigin();
  const origin = request.headers.get("origin");
  if (!origin || origin !== expected) {
    return { ok: false, error: "invalid origin" };
  }
  return { ok: true };
}
