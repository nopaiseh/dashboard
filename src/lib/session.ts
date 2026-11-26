import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getSessionSecret } from "@/lib/env";
import type { SessionPayload } from "@/lib/types";

export const SESSION_COOKIE_NAME = "xjg_session";
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000; // 12 hours idle

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret());
}

export async function createSessionToken(
  now: Date = new Date(),
): Promise<string> {
  const lastActivity = Math.floor(now.getTime() / 1000);
  return new SignJWT({
    sub: "owner",
    lastActivity,
  } satisfies Omit<SessionPayload, "iat"> & JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(lastActivity)
    .setExpirationTime(lastActivity + Math.floor(SESSION_IDLE_MS / 1000))
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string,
  now: Date = new Date(),
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
    });
    if (payload.sub !== "owner") {
      return null;
    }
    const lastActivity =
      typeof payload.lastActivity === "number"
        ? payload.lastActivity
        : typeof payload.iat === "number"
          ? payload.iat
          : 0;
    const idleDeadline = lastActivity * 1000 + SESSION_IDLE_MS;
    if (now.getTime() > idleDeadline) {
      return null;
    }
    return {
      sub: "owner",
      iat: typeof payload.iat === "number" ? payload.iat : lastActivity,
      lastActivity,
    };
  } catch {
    return null;
  }
}

/** 滑动闲置：校验通过则签发新 token 刷新 lastActivity。 */
export async function touchSessionToken(
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  const session = await verifySessionToken(token, now);
  if (!session) {
    return null;
  }
  return createSessionToken(now);
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
