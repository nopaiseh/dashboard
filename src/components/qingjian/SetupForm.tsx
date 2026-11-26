"use client";

import Link from "next/link";
import { useId, useState, useTransition, type FormEvent } from "react";
import { PasskeyError, registerWithPasskey } from "@/lib/ui/passkey-client";

const NEUTRAL_SENT =
  "若该邮箱获准，登录链接已发送。请打开邮件并点击确认。";

/**
 * 登记失败文案：不泄漏服务端/浏览器细节。
 * NotAllowedError 亦可能来自认证器不支持 resident keys，故不用「已取消」。
 * 403：setup-grant 缺失/过期，或 invite 令牌无效。
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

/** 尚未拿到 setup-grant：只收集邮箱并发魔法链接。 */
export function SetupEmailForm({ siteName }: { siteName: string }) {
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) {
      setError("请输入邮箱");
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/setup/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
        if (res.status === 429) {
          setError("请求过于频繁，请稍后再试");
          return;
        }
        if (!res.ok) {
          setError("发送失败，请重试");
          return;
        }
        setSent(true);
      } catch {
        setError("发送失败，请重试");
      }
    });
  }

  return (
    <main className={"qj-login"}>
      <div className={"qj-loginBox"}>
        <h1 className={"qj-loginBrand"}>{siteName}</h1>
        {sent ? (
          <p className={"qj-setupStatus"} role="status">
            {NEUTRAL_SENT}
          </p>
        ) : (
          <form className={"qj-setupForm"} onSubmit={onSubmit}>
            <div className={"qj-setupField"}>
              <label htmlFor={emailId} className={"qj-setupLabel"}>
                邮箱
              </label>
              <input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                className={"qj-setupInput"}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
              />
            </div>
            <button
              type="submit"
              className={"qj-passkeyBtn"}
              disabled={pending}
            >
              {pending ? "发送中…" : "发送登录链接"}
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

/** 持有有效 setup-grant：登记通行密钥。 */
export function SetupPasskeyForm({ siteName }: { siteName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await registerWithPasskey();
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
            <p className={"qj-setupStatus"} role="status">
              邮箱已确认。请登记通行密钥。
            </p>
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
