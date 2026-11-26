import { connection } from "next/server";
import { LoginForm } from "@/components/qingjian/LoginForm";
import { getSiteName } from "@/lib/env";
import { hasWebAuthnCredential } from "@/lib/webauthn-credentials";

/** 需动态渲染以接收 proxy 注入的 CSP nonce。 */
export const instant = false;

/**
 * 登录页：站名与通行密钥按钮；无凭据时附带首次登记入口。
 */
export default async function LoginPage() {
  await connection();

  let siteName = "玄机阁";
  try {
    siteName = getSiteName();
  } catch {
    siteName = "玄机阁";
  }

  const registered = await hasWebAuthnCredential();

  return (
    <LoginForm siteName={siteName} showSetupLink={!registered} />
  );
}
