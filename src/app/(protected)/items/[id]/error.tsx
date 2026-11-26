"use client";

import { ProtectedReadError } from "@/components/qingjian/ProtectedReadError";

/** 事项详情读失败边界；壳内渲染以保留顶栏。 */
export default function ItemDetailError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ProtectedReadError reset={reset} />;
}
