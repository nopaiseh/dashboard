import { NextResponse } from "next/server";

export function jsonError(
  status: number,
  error: string,
  extra?: Record<string, unknown>,
): NextResponse {
  const init: ResponseInit = { status };
  if (
    status === 429 &&
    typeof extra?.retryAfterSeconds === "number" &&
    Number.isFinite(extra.retryAfterSeconds)
  ) {
    init.headers = {
      "Retry-After": String(
        Math.max(1, Math.ceil(extra.retryAfterSeconds)),
      ),
    };
  }
  return NextResponse.json({ error, ...extra }, init);
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

/** Success JSON with Cache-Control: no-store (decrypted / sensitive bodies). */
export function jsonOkNoStore<T>(
  data: T,
  init?: ResponseInit,
): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(data, { ...init, headers });
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip") || "unknown";
}

export const NOINDEX_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow",
} as const;
