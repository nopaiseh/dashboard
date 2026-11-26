import { connection } from "next/server";
import { requireSessionOrRedirect } from "@/lib/auth-guard";

/**
 * 受保护路由必须全动态：先 connection()，再验会话。
 * 禁止任何静态/预渲染壳（否则缺密钥构建会固化跳转 /login，nonce 不全）。
 */
export const instant = false;

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();
  await requireSessionOrRedirect();
  return children;
}
