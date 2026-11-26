import { jsonOk } from "@/lib/http";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session";
import { NextResponse } from "next/server";

export async function POST() {
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
