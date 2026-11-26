import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  if (!process.env.SESSION_SECRET) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

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

/** 受保护布局：服务器端再验一次会话。 */
export async function requireSessionOrRedirect(): Promise<void> {
  const session = await requireSession();
  if (!session.ok) {
    redirect("/login");
  }
}
