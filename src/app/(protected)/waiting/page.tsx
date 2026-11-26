import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { ItemList } from "@/components/qingjian/ItemList";
import { loadItemsByKind, type ItemWithMeta } from "@/lib/ui/data";
import { loadShellData } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function WaitingPage() {
  await connection();
  const { siteName, counts } = await loadShellData();
  let items: ItemWithMeta[] = [];
  try {
    items = await loadItemsByKind("waiting", "open");
  } catch {
    items = [];
  }

  return (
    <AppShell active="waiting" counts={counts} siteName={siteName}>
      <div className={"qj-pageTitleRow"}>
        <h1>等别人</h1>
      </div>
      <ItemList items={items} emptyText="没有在等别人的事项" />
    </AppShell>
  );
}
