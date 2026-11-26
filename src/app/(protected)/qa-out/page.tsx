import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { ItemList } from "@/components/qingjian/ItemList";
import { loadItemsByKind, type ItemWithMeta } from "@/lib/ui/data";
import { loadShellData } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function QaOutPage() {
  await connection();
  const { siteName, counts } = await loadShellData();
  let items: ItemWithMeta[] = [];
  try {
    // 你问的：含已回复，便于看读取状态（读取字段待接口）
    items = await loadItemsByKind("question_from_user");
  } catch {
    items = [];
  }

  return (
    <AppShell active="qa-out" counts={counts} siteName={siteName}>
      <div className={"qj-pageTitleRow"}>
        <h1>你问的</h1>
      </div>
      <ItemList items={items} emptyText="没有你问出的事项" />
    </AppShell>
  );
}
