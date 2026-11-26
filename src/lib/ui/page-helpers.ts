import "server-only";

import { redirect } from "next/navigation";
import { getSiteName } from "@/lib/env";
import {
  isSessionRequiredError,
  loadCounts,
  type Counts,
} from "@/lib/read";
import { DEFAULT_SITE_NAME } from "@/lib/ui/page-helpers-shared";

export { DEFAULT_SITE_NAME };

/**
 * 受保护页的读操作守卫：会话中途失效时跳转登录，其它错误继续抛给 error.tsx。
 * 不修改 src/lib/read。
 */
export async function withUiReadGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isSessionRequiredError(err)) {
      redirect("/login");
    }
    throw err;
  }
}

export async function loadShellData(): Promise<{
  siteName: string;
  counts: Counts;
}> {
  let siteName = DEFAULT_SITE_NAME;
  try {
    siteName = getSiteName();
  } catch {
    siteName = DEFAULT_SITE_NAME;
  }

  // 读失败必须抛出，由 error.tsx 处理；禁止吞掉后显示「0 待批」假空态
  // SessionRequiredError → /login（见 withUiReadGuard / 下方 catch）
  try {
    const counts = await loadCounts();
    return { siteName, counts };
  } catch (err) {
    if (isSessionRequiredError(err)) {
      redirect("/login");
    }
    throw err;
  }
}
