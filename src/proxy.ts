import { NextResponse, type NextRequest } from "next/server";
import { isPublicStaticAsset } from "@/lib/public-assets";
import {
  STATIC_SECURITY_HEADERS,
  buildCspHeader,
  generateCspNonce,
} from "@/lib/security-headers";
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MS,
  sessionCookieOptions,
  touchSessionToken,
  verifySessionToken,
} from "@/lib/session";
import { isSessionSecretConfigured } from "@/lib/env";

const PUBLIC_PATHS = new Set([
  "/login",
  "/robots.txt",
  "/favicon.ico",
]);

/** 已移除的首次登记路径：一律 404（勿重定向到 /login）。 */
const REMOVED_PATHS = new Set(["/setup", "/setup/confirm"]);

const PUBLIC_API_PREFIXES = [
  "/api/auth/options",
  "/api/auth/verify",
  // 尾斜杠：避免 /api/auth/registerX 被 startsWith 误放行
  "/api/auth/register/",
  "/api/agent/",
];

function isRemovedRegistrationPath(pathname: string): boolean {
  if (REMOVED_PATHS.has(pathname)) {
    return true;
  }
  return (
    pathname === "/api/auth/setup" || pathname.startsWith("/api/auth/setup/")
  );
}

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }
  if (isPublicStaticAsset(pathname)) {
    return true;
  }
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

/** One-time admin paths: unauthenticated → 404 (do not redirect to /login). */
function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/api/admin" ||
    pathname.startsWith("/api/admin/")
  );
}

function withSecurity(
  request: NextRequest,
  res: NextResponse,
  nonce: string,
): NextResponse {
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  const csp = buildCspHeader(nonce);
  res.headers.set("Content-Security-Policy", csp);
  void request;
  return res;
}

function nextWithNonce(request: NextRequest, nonce: string): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", buildCspHeader(nonce));
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = generateCspNonce();

  if (pathname.startsWith("/_next/static") || pathname.startsWith("/_next/image")) {
    return withSecurity(request, nextWithNonce(request, nonce), nonce);
  }

  if (isPublicStaticAsset(pathname)) {
    return withSecurity(request, nextWithNonce(request, nonce), nonce);
  }

  if (isRemovedRegistrationPath(pathname)) {
    return withSecurity(
      request,
      new NextResponse(null, { status: 404 }),
      nonce,
    );
  }

  if (isPublic(pathname)) {
    return withSecurity(request, nextWithNonce(request, nonce), nonce);
  }

  // 缺 SESSION_SECRET 或长度不足一律拒绝
  if (!isSessionSecretConfigured()) {
    if (pathname.startsWith("/api/")) {
      return withSecurity(
        request,
        NextResponse.json({ error: "unauthorized" }, { status: 401 }),
        nonce,
      );
    }
    return withSecurity(
      request,
      NextResponse.redirect(new URL("/login", request.url)),
      nonce,
    );
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let authed = false;
  if (token) {
    try {
      authed = (await verifySessionToken(token)) !== null;
    } catch {
      authed = false;
    }
  }

  if (!authed) {
    if (isAdminPath(pathname)) {
      if (pathname.startsWith("/api/")) {
        return withSecurity(
          request,
          NextResponse.json(
            { error: "not found" },
            {
              status: 404,
              headers: { "Cache-Control": "no-store" },
            },
          ),
          nonce,
        );
      }
      return withSecurity(
        request,
        new NextResponse(null, {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        }),
        nonce,
      );
    }
    if (pathname.startsWith("/api/")) {
      return withSecurity(
        request,
        NextResponse.json({ error: "unauthorized" }, { status: 401 }),
        nonce,
      );
    }
    return withSecurity(
      request,
      NextResponse.redirect(new URL("/login", request.url)),
      nonce,
    );
  }

  const response = withSecurity(request, nextWithNonce(request, nonce), nonce);
  if (isAdminPath(pathname)) {
    response.headers.set("Cache-Control", "no-store");
  }

  // 滑动续期在 proxy 写 cookie（页面内 jar.set 会被 Next 拒绝）
  if (token) {
    try {
      const refreshed = await touchSessionToken(token);
      if (refreshed) {
        response.cookies.set(
          SESSION_COOKIE_NAME,
          refreshed,
          sessionCookieOptions(Math.floor(SESSION_IDLE_MS / 1000)),
        );
      }
    } catch {
      // 续期失败不影响放行；下次请求再试
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
