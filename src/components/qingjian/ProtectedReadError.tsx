"use client";

import { usePathname } from "next/navigation";
import { DEFAULT_SITE_NAME } from "@/lib/ui/page-helpers-shared";
import { navTabFromPathname } from "@/lib/ui/labels";
import { AppShell } from "./AppShell";
import { ReadError } from "./ReadError";

/**
 * 读失败边界：保留顶栏/底栏（AppShell），仅内容区显示错误与重试。
 * counts 未知时传 null，避免假「0 待批」。
 */
export function ProtectedReadError({ reset }: { reset: () => void }) {
  const pathname = usePathname();
  const active = navTabFromPathname(pathname);

  return (
    <AppShell active={active} counts={null} siteName={DEFAULT_SITE_NAME}>
      <ReadError reset={reset} />
    </AppShell>
  );
}
