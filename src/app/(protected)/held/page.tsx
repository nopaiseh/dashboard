import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { ItemList } from "@/components/qingjian/ItemList";
import { loadHeldItems, type ItemWithMeta } from "@/lib/ui/data";
import { loadShellData } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function HeldPage() {
  await connection();
  const { siteName, counts } = await loadShellData();
  let items: ItemWithMeta[] = [];
  try {
    items = await loadHeldItems();
  } catch {
    items = [];
  }

  return (
    <AppShell active="held" counts={counts} siteName={siteName}>
      <div className={"qj-pageTitleRow"}>
        <h1>搁置</h1>
        <p className={"qj-listHint"}>7 天无动静自动归入</p>
      </div>
      <ItemList items={items} emptyText="没有搁置事项" />
    </AppShell>
  );
}
