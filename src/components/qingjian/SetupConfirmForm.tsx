"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";

/**
 * 邮件链接落地后须手动点击确认，避免聊天/邮件预览 GET 消费 token_hash。
 */
export function SetupConfirmForm({
  siteName,
  tokenHash,
}: {
  siteName: string;
  tokenHash: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/auth/setup/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token_hash: tokenHash, type: "email" }),
        });
        if (!res.ok) {
          setError("链接无效或已过期，请回到登记页重新发送");
          return;
        }
        router.replace("/setup");
        router.refresh();
      } catch {
        setError("确认失败，请重试");
      }
    });
  }

  return (
    <main className={"qj-login"}>
      <div className={"qj-loginBox"}>
        <h1 className={"qj-loginBrand"}>{siteName}</h1>
        <form className={"qj-setupForm"} onSubmit={onSubmit}>
          <p className={"qj-setupStatus"} role="status">
            请点击下方按钮确认邮箱，以继续登记通行密钥。
          </p>
          <button
            type="submit"
            className={"qj-passkeyBtn"}
            disabled={pending}
          >
            {pending ? "确认中…" : "确认邮箱"}
          </button>
          {error ? (
            <p className={"qj-loginError"} role="alert">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </main>
  );
}

export function SetupConfirmMissing({ siteName }: { siteName: string }) {
  return (
    <main className={"qj-login"}>
      <div className={"qj-loginBox"}>
        <h1 className={"qj-loginBrand"}>{siteName}</h1>
        <p className={"qj-setupStatus"} role="status">
          链接无效。请回到登记页重新发送邮件。
        </p>
      </div>
    </main>
  );
}
