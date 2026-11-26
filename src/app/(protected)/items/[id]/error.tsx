"use client";

import { ReadError } from "@/components/qingjian/ReadError";

/** 事项详情读失败边界。 */
export default function ItemDetailError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ReadError reset={reset} />;
}
