"use client";

import { startTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * 受保护路由读失败时的平静错误态。
 * 由 error.tsx 边界使用；重试时先 refresh 再 reset，以便 DB 恢复后拉新数据。
 */
export function runErrorRetry(
  router: { refresh: () => void },
  reset: () => void,
): void {
  startTransition(() => {
    router.refresh();
    reset();
  });
}

export function ReadError({
  reset,
  title = "暂时读不到数据",
  hint = "请稍后再试。",
}: {
  reset: () => void;
  title?: string;
  hint?: string;
}) {
  const router = useRouter();

  return (
    <div className="qj-error" role="alert">
      <h1 className="qj-errorTitle">{title}</h1>
      <p className="qj-errorHint">{hint}</p>
      <button
        type="button"
        className="qj-errorRetry"
        onClick={() => runErrorRetry(router, reset)}
      >
        重试
      </button>
    </div>
  );
}
