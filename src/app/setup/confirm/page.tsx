import { connection } from "next/server";
import {
  SetupConfirmForm,
  SetupConfirmMissing,
} from "@/components/qingjian/SetupConfirmForm";
import { SetupAlreadyRegistered } from "@/components/qingjian/SetupForm";
import { getSiteName } from "@/lib/env";
import { hasWebAuthnCredential } from "@/lib/webauthn-credentials";

/** 需动态渲染以接收 proxy 注入的 CSP nonce。 */
export const instant = false;

/**
 * 魔法链接落地页：仅展示确认按钮，不在 GET 时校验 token（防预览消费）。
 */
export default async function SetupConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();

  let siteName = "玄机阁";
  try {
    siteName = getSiteName();
  } catch {
    siteName = "玄机阁";
  }

  if (await hasWebAuthnCredential()) {
    return <SetupAlreadyRegistered siteName={siteName} />;
  }

  const params = await searchParams;
  const rawHash = params.token_hash;
  const rawType = params.type;
  const tokenHash = typeof rawHash === "string" ? rawHash : "";
  const type =
    rawType === "magiclink" || rawType === "email" ? rawType : null;

  if (!tokenHash || !type) {
    return <SetupConfirmMissing siteName={siteName} />;
  }

  return (
    <SetupConfirmForm siteName={siteName} tokenHash={tokenHash} type={type} />
  );
}
