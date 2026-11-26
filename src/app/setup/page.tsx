import { connection } from "next/server";
import {
  SetupAlreadyRegistered,
  SetupEmailForm,
  SetupPasskeyForm,
} from "@/components/qingjian/SetupForm";
import { getSiteName } from "@/lib/env";
import { hasValidSetupGrant } from "@/lib/setup-grant";
import { hasWebAuthnCredential } from "@/lib/webauthn-credentials";

/** 需动态渲染以接收 proxy 注入的 CSP nonce。 */
export const instant = false;

/**
 * 首次通行密钥登记页。
 * 已有凭据 →「已注册」；有 setup-grant → 登记 passkey；否则 → 邮箱魔法链接。
 */
export default async function SetupPage() {
  await connection();

  let siteName = "玄机阁";
  try {
    siteName = getSiteName();
  } catch {
    siteName = "玄机阁";
  }

  const registered = await hasWebAuthnCredential();
  if (registered) {
    return <SetupAlreadyRegistered siteName={siteName} />;
  }

  const grantOk = await hasValidSetupGrant();
  if (grantOk) {
    return <SetupPasskeyForm siteName={siteName} />;
  }

  return <SetupEmailForm siteName={siteName} />;
}
