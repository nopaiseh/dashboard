import { NextResponse } from "next/server";
import { jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";

export async function POST(request: Request) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}

export async function GET() {
  return jsonOk({ ok: true });
}
