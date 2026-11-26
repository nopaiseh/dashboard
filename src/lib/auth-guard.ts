import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { isSessionSecretConfigured } from "@/lib/env";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/session";

/**
 * 页面/API 会话校验：只验证，不写 cookie（续期在 proxy）。
 * 必须先触达 cookies()/connection()，再判断密钥——否则无密钥构建会把
 * 「跳转 /login」固化进静态壳，导致合法会话仍 307、nonce 不全。
 */
export async function requireSession(): Promise<
  | { ok: true }
  | { ok: false; status: 401; error: string }
> {
  const jar = await cookies();

  if (!isSessionSecretConfigured()) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const token = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  return { ok: true };
}

/** 受保护布局：先 connection() 强制全动态，再验会话。 */
export async function requireSessionOrRedirect(): Promise<void> {
  await connection();
  const session = await requireSession();
  if (!session.ok) {
    redirect("/login");
  }
}
