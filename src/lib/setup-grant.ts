import "server-only";

import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSessionSecret } from "@/lib/env";
import { getServiceClient } from "@/lib/supabase/server";

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

/** 仅校验 JWT 签名与声明（不含服务端 jti 吊销）。 */
export async function verifySetupGrantToken(
  token: string,
  now: Date = new Date(),
): Promise<boolean> {
  return (await parseSetupGrantJti(token, now)) !== null;
}

async function parseSetupGrantJti(
  token: string,
  now: Date,
): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      audience: SETUP_GRANT_AUD,
      currentDate: now,
    });
    const jti = payload.jti;
    if (
      payload.sub !== "owner-setup" ||
      typeof jti !== "string" ||
      jti.length === 0 ||
      (payload as { purpose?: string }).purpose !== "setup"
    ) {
      return null;
    }
    return jti;
  } catch {
    return null;
  }
}

/**
 * 服务端 jti 吊销：登记成功后写入 webauthn_registration.consumed_setup_grant_jti，
 * 同 jti 不可再用于 bootstrap（即使 cookie 仍在、凭据稍后被清空）。
 */
async function isSetupGrantJtiConsumed(jti: string): Promise<boolean> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("webauthn_registration")
    .select("consumed_setup_grant_jti")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    // 读失败时 fail closed：拒绝 grant，避免已消费 jti 被放过
    return true;
  }
  return data.consumed_setup_grant_jti === jti;
}

/** 登记成功后写入 jti，使该 grant 不可再用于 bootstrap。 */
export async function consumeSetupGrantJti(jti: string): Promise<void> {
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("webauthn_registration")
    .update({
      consumed_setup_grant_jti: jti,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) {
    console.error("[setup-grant] failed to consume jti:", error.message);
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

/**
 * 从 cookie 读取并校验 setup grant（含 jti 吊销）。
 * 无效、缺失或 jti 已消费 → false。
 */
export async function hasValidSetupGrant(
  now: Date = new Date(),
): Promise<boolean> {
  return (await readValidSetupGrantJti(now)) !== null;
}

/** 读取并校验 cookie 中的 grant，返回 jti（供登记成功后消费）。 */
export async function readValidSetupGrantJti(
  now: Date = new Date(),
): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SETUP_GRANT_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  const jti = await parseSetupGrantJti(token, now);
  if (!jti) {
    return null;
  }
  if (await isSetupGrantJtiConsumed(jti)) {
    return null;
  }
  return jti;
}

/** 清除 grant 时的 cookie 选项（maxAge 0）。 */
export function clearedSetupGrantCookieOptions() {
  return setupGrantCookieOptions(0);
}
