/** 不含 CSP（CSP 须按请求带 nonce，由 proxy 生成）。 */
export const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security":
    "max-age=63072000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** @deprecated 使用 STATIC_SECURITY_HEADERS；CSP 由 buildCspHeader 生成 */
export const SECURITY_HEADERS = STATIC_SECURITY_HEADERS;

export function generateCspNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

/**
 * 生产：script-src 仅 'self' + nonce + strict-dynamic，不加 unsafe-inline/unsafe-eval。
 * 开发：允许 unsafe-eval（React 调试需要）。
 */
export function buildCspHeader(
  nonce: string,
  options?: { isDev?: boolean },
): string {
  const isDev =
    options?.isDev ?? process.env.NODE_ENV === "development";
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function applyStaticSecurityHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    headers.set(key, value);
  }
}
