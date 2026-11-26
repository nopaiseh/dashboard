import { NextResponse, type NextRequest } from "next/server";
import { isPublicStaticAsset } from "@/lib/public-assets";
import {
  STATIC_SECURITY_HEADERS,
  buildCspHeader,
  generateCspNonce,
} from "@/lib/security-headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";
import { isSessionSecretConfigured } from "@/lib/env";

const PUBLIC_PATHS = new Set(["/login", "/robots.txt", "/favicon.ico"]);

const PUBLIC_API_PREFIXES = [
  "/api/auth/options",
  "/api/auth/verify",
  "/api/auth/register",
  "/api/agent/",
];

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

  return withSecurity(request, nextWithNonce(request, nonce), nonce);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
