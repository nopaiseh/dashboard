"use client";

import { ProtectedReadError } from "@/components/qingjian/ProtectedReadError";

/** 受保护段读失败边界；壳内渲染以保留顶栏。 */
export default function ProtectedError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ProtectedReadError reset={reset} />;
}
