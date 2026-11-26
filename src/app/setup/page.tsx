import { connection } from "next/server";
import {
  SetupAlreadyRegistered,
  SetupForm,
} from "@/components/qingjian/SetupForm";
import { getSiteName } from "@/lib/env";
import { hasWebAuthnCredential } from "@/lib/webauthn-credentials";

/** 需动态渲染以接收 proxy 注入的 CSP nonce。 */
export const instant = false;

/**
 * 首次通行密钥登记页。已有凭据时仅显示「已注册」。
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

  return <SetupForm siteName={siteName} />;
}
