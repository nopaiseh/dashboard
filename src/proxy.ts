import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

const PUBLIC_PATHS = new Set([
  "/login",
  "/robots.txt",
  "/favicon.ico",
]);

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
  return PUBLIC_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix),
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const responseHeaders = {
    "X-Robots-Tag": "noindex, nofollow",
  };

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    /\.[a-zA-Z0-9]+$/.test(pathname)
  ) {
    const res = NextResponse.next();
    Object.entries(responseHeaders).forEach(([k, v]) =>
      res.headers.set(k, v),
    );
    return res;
  }

  if (isPublic(pathname)) {
    const res = NextResponse.next();
    Object.entries(responseHeaders).forEach(([k, v]) =>
      res.headers.set(k, v),
    );
    return res;
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let authed = false;
  if (token) {
    try {
      // Proxy 可能无完整 env；仅做 JWT 结构校验。完整校验在 route 内。
      if (process.env.SESSION_SECRET) {
        authed = (await verifySessionToken(token)) !== null;
      } else {
        authed = token.length > 0;
      }
    } catch {
      authed = false;
    }
  }

  if (!authed) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: responseHeaders },
      );
    }
    const loginUrl = new URL("/login", request.url);
    const redirect = NextResponse.redirect(loginUrl);
    Object.entries(responseHeaders).forEach(([k, v]) =>
      redirect.headers.set(k, v),
    );
    return redirect;
  }

  const res = NextResponse.next();
  Object.entries(responseHeaders).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
