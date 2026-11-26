import "server-only";

import { getSiteName } from "@/lib/env";
import { loadCounts, type Counts } from "@/lib/ui/data";

export async function loadShellData(): Promise<{
  siteName: string;
  counts: Counts;
}> {
  let siteName = "玄机阁";
  try {
    siteName = getSiteName();
  } catch {
    siteName = "玄机阁";
  }

  // 读失败必须抛出，由 error.tsx 处理；禁止吞掉后显示「0 待批」假空态
  const counts = await loadCounts();
  return { siteName, counts };
}
