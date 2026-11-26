"use client";

import { ReadError } from "@/components/qingjian/ReadError";

/** 受保护段读失败边界；保持客户端以便调用 reset()。 */
export default function ProtectedError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ReadError reset={reset} />;
}
