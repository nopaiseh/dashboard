import { NextResponse, type NextRequest } from "next/server";
import { isPublicStaticAsset } from "@/lib/public-assets";
import { SECURITY_HEADERS } from "@/lib/security-headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

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

function withSecurity(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next/static") || pathname.startsWith("/_next/image")) {
    return withSecurity(NextResponse.next());
  }

  // 仅白名单内的 public 静态文件可匿名；任意扩展名不再放行
  if (isPublicStaticAsset(pathname)) {
    return withSecurity(NextResponse.next());
  }

  if (isPublic(pathname)) {
    return withSecurity(NextResponse.next());
  }

  // 缺 SESSION_SECRET 一律拒绝（不得仅凭 cookie 非空放行）
  if (!process.env.SESSION_SECRET) {
    if (pathname.startsWith("/api/")) {
      return withSecurity(
        NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      );
    }
    return withSecurity(NextResponse.redirect(new URL("/login", request.url)));
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
        NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      );
    }
    return withSecurity(NextResponse.redirect(new URL("/login", request.url)));
  }

  return withSecurity(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
