import { connection } from "next/server";
import { LoginForm } from "@/components/qingjian/LoginForm";
import { getSiteName } from "@/lib/env";

/** 需动态渲染以接收 proxy 注入的 CSP nonce。 */
export const instant = false;

/**
 * 登录页：站名、通行密钥按钮，以及中性的首次注册入口（不查询凭据状态）。
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
