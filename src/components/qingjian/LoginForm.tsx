"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LOCKOUT_MESSAGE } from "@/lib/ui/labels";
import { loginWithPasskey, PasskeyError } from "@/lib/ui/passkey-client";
import { FingerprintIcon } from "./FingerprintIcon";

export function LoginForm({
  siteName,
  showSetupLink = false,
}: {
  siteName: string;
  /** 仅在服务端确认尚无凭据时为 true。 */
  showSetupLink?: boolean;
}) {
  const router = useRouter();
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onLogin() {
    setError(null);
    startTransition(async () => {
      try {
        await loginWithPasskey();
        router.replace("/");
        router.refresh();
      } catch (err) {
        if (err instanceof PasskeyError && err.status === 429) {
          setLocked(true);
          return;
        }
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("已取消通行密钥验证");
          return;
        }
        setError("登录失败，请重试");
      }
    });
  }

  return (
    <div className={"qj-login"}>
      <div className={"qj-loginBox"}>
        <h1 className={"qj-loginBrand"}>{siteName}</h1>
        {locked ? (
          <p className={"qj-lockMsg"} role="status">
            {LOCKOUT_MESSAGE}
          </p>
        ) : (
          <>
            <button
              type="button"
              className={"qj-passkeyBtn"}
              onClick={onLogin}
              disabled={pending}
            >
              <FingerprintIcon />
              {pending ? "验证中…" : "使用通行密钥登录"}
            </button>
            {error ? (
              <p className={"qj-loginError"} role="alert">
                {error}
              </p>
            ) : null}
            {showSetupLink ? (
              <Link href="/setup" className={"qj-setupEntry"}>
                首次登记通行密钥
              </Link>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
