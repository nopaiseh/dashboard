import "server-only";

import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSessionSecret } from "@/lib/env";

/** 短时 setup 授权 cookie：仅允许首次 WebAuthn 登记。 */
export const SETUP_GRANT_COOKIE_NAME = "xjg_setup_grant";
export const SETUP_GRANT_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const SETUP_GRANT_AUD = "xjg-setup-grant";

function secretKey(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret());
}

export async function createSetupGrantToken(
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ purpose: "setup" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner-setup")
    .setAudience(SETUP_GRANT_AUD)
    .setJti(randomUUID())
    .setIssuedAt(iat)
    .setExpirationTime(iat + Math.floor(SETUP_GRANT_TTL_MS / 1000))
    .sign(secretKey());
}

export async function verifySetupGrantToken(
  token: string,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      audience: SETUP_GRANT_AUD,
      currentDate: now,
    });
    return (
      payload.sub === "owner-setup" &&
      typeof payload.jti === "string" &&
      payload.jti.length > 0 &&
      (payload as { purpose?: string }).purpose === "setup"
    );
  } catch {
    return false;
  }
}

export function setupGrantCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** 从 cookie jar 读取并校验 setup grant；无效或缺失 → false。 */
export async function hasValidSetupGrant(
  now: Date = new Date(),
): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(SETUP_GRANT_COOKIE_NAME)?.value;
  if (!token) {
    return false;
  }
  return verifySetupGrantToken(token, now);
}

/** 清除 grant 时的 cookie 选项（maxAge 0）。 */
export function clearedSetupGrantCookieOptions() {
  return setupGrantCookieOptions(0);
}
