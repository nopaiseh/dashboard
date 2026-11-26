"use client";

import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";
import { PasskeyError, registerWithPasskey } from "@/lib/ui/passkey-client";

/**
 * 登记失败文案：不泄漏服务端/浏览器细节。
 * NotAllowedError 亦可能来自认证器不支持 resident keys，故不用「已取消」。
 * 令牌被拒（register options/verify → 403）单独提示。
 */
export function setupRegistrationErrorMessage(err: unknown): string {
  if (err instanceof PasskeyError && err.status === 403) {
    return "令牌无效或已失效";
  }
  if (err instanceof Error && err.name === "NotAllowedError") {
    return "未完成登记，请确认使用支持通行密钥的认证器，或重试";
  }
  return "注册未完成，请确认密码管理器支持通行密钥后重试";
}

export function SetupForm({ siteName }: { siteName: string }) {
  const tokenId = useId();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = token.trim();
    if (!trimmed) {
      setError("请输入启动令牌");
      return;
    }
    startTransition(async () => {
      try {
        await registerWithPasskey(trimmed);
        setDone(true);
      } catch (err) {
        setError(setupRegistrationErrorMessage(err));
      }
    });
  }

  return (
    <main className={"qj-login"}>
      <div className={"qj-loginBox"}>
        <h1 className={"qj-loginBrand"}>{siteName}</h1>
        {done ? (
          <p className={"qj-setupStatus"} role="status">
            登记成功。请前往{" "}
            <Link href="/login" className={"qj-setupLink"}>
              登录
            </Link>
            。
          </p>
        ) : (
          <form className={"qj-setupForm"} onSubmit={onSubmit}>
            <div className={"qj-setupField"}>
              <label htmlFor={tokenId} className={"qj-setupLabel"}>
                BOOTSTRAP_TOKEN
              </label>
              <input
                id={tokenId}
                name="bootstrap_token"
                type="password"
                autoComplete="off"
                spellCheck={false}
                className={"qj-setupInput"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                disabled={pending}
              />
            </div>
            <button
              type="submit"
              className={"qj-passkeyBtn"}
              disabled={pending}
            >
              {pending ? "登记中…" : "登记通行密钥"}
            </button>
            {error ? (
              <p className={"qj-loginError"} role="alert">
                {error}
              </p>
            ) : null}
          </form>
        )}
      </div>
    </main>
  );
}

/** 已有凭据时的中性状态；不暴露数量、id 或错误详情。 */
export function SetupAlreadyRegistered({ siteName }: { siteName: string }) {
  return (
    <main className={"qj-login"}>
      <div className={"qj-loginBox"}>
        <h1 className={"qj-loginBrand"}>{siteName}</h1>
        <p className={"qj-setupStatus"} role="status">
          已注册
        </p>
      </div>
    </main>
  );
}
