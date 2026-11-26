import { SignJWT, jwtVerify, type JWTPayload } from "jose";
import { getSessionSecret } from "@/lib/env";
import type { SessionPayload } from "@/lib/types";

export const SESSION_COOKIE_NAME = "xjg_session";
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000; // 12 hours idle
/** 会话绝对上限：自首次签发（iat）起 7 天，滑动续期不延长。 */
export const SESSION_ABSOLUTE_MAX = 7 * 24 * 60 * 60 * 1000;

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret());
}

/**
 * 签发会话。`issuedAtSeconds` 为首次登录时间（unix 秒）；
 * 滑动续期传入原 iat，不得改写。
 */
export async function createSessionToken(
  now: Date = new Date(),
  issuedAtSeconds?: number,
): Promise<string> {
  const lastActivity = Math.floor(now.getTime() / 1000);
  const iat = issuedAtSeconds ?? lastActivity;
  return new SignJWT({
    sub: "owner",
    lastActivity,
  } satisfies Omit<SessionPayload, "iat"> & JWTPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(iat)
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
      currentDate: now,
    });
    if (payload.sub !== "owner") {
      return null;
    }
    // 旧会话无 iat → 视为过期，必须重新登录
    if (typeof payload.iat !== "number") {
      return null;
    }
    const absoluteDeadline = payload.iat * 1000 + SESSION_ABSOLUTE_MAX;
    if (now.getTime() > absoluteDeadline) {
      return null;
    }

    const lastActivity =
      typeof payload.lastActivity === "number"
        ? payload.lastActivity
        : payload.iat;
    const idleDeadline = lastActivity * 1000 + SESSION_IDLE_MS;
    if (now.getTime() > idleDeadline) {
      return null;
    }
    return {
      sub: "owner",
      iat: payload.iat,
      lastActivity,
    };
  } catch {
    return null;
  }
}

/** 滑动闲置：校验通过则签发新 token 刷新 lastActivity，保留原 iat。 */
export async function touchSessionToken(
  token: string,
  now: Date = new Date(),
): Promise<string | null> {
  const session = await verifySessionToken(token, now);
  if (!session) {
    return null;
  }
  return createSessionToken(now, session.iat);
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
