import { connection } from "next/server";
import { getSiteName } from "@/lib/env";
import { LoginForm } from "@/components/qingjian/LoginForm";

/** 需动态渲染以接收 proxy 注入的 CSP nonce。 */
export const instant = false;

/**
 * 登录页：只显示站名与通行密钥按钮。
 */
export default async function LoginPage() {
  await connection();

  let siteName = "玄机阁";
  try {
    siteName = getSiteName();
  } catch {
    siteName = "玄机阁";
  }

  return <LoginForm siteName={siteName} />;
}
