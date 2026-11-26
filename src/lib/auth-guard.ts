import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MS,
  sessionCookieOptions,
  touchSessionToken,
  verifySessionToken,
} from "@/lib/session";

export async function requireSession(): Promise<
  | { ok: true }
  | { ok: false; status: 401; error: string }
> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const refreshed = await touchSessionToken(token);
  if (refreshed) {
    jar.set(
      SESSION_COOKIE_NAME,
      refreshed,
      sessionCookieOptions(Math.floor(SESSION_IDLE_MS / 1000)),
    );
  }

  return { ok: true };
}

export async function hasValidSessionCookie(
  cookieHeader: string | null,
): Promise<boolean> {
  if (!cookieHeader) {
    return false;
  }
  const match = new RegExp(
    `(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`,
  ).exec(cookieHeader);
  const token = match?.[1];
  if (!token) {
    return false;
  }
  const session = await verifySessionToken(decodeURIComponent(token));
  return session !== null;
}
