"use client";

/**
 * 受保护路由读失败时的平静错误态。
 * 由 error.tsx 边界使用；点击重试调用 reset()。
 */
export function ReadError({
  reset,
  title = "暂时读不到数据",
  hint = "请稍后再试。",
}: {
  reset: () => void;
  title?: string;
  hint?: string;
}) {
  return (
    <main className="qj-error" role="alert">
      <h1 className="qj-errorTitle">{title}</h1>
      <p className="qj-errorHint">{hint}</p>
      <button type="button" className="qj-errorRetry" onClick={() => reset()}>
        重试
      </button>
    </main>
  );
}
