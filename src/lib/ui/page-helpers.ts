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

  let counts: Counts = {
    approval: 0,
    todo: 0,
    question_to_user: 0,
    question_from_user: 0,
    waiting: 0,
    held: 0,
  };
  try {
    counts = await loadCounts();
  } catch {
    // 构建或密钥占位时允许空数据
  }
  return { siteName, counts };
}
