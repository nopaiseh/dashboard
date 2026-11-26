import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { ItemList } from "@/components/qingjian/ItemList";
import { loadItemsByKind } from "@/lib/read";
import { ONE_BY_ONE_HINT } from "@/lib/ui/labels";
import { loadShellData } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function PendingPage() {
  await connection();
  const { siteName, counts } = await loadShellData();
  const items = await loadItemsByKind("approval", "open");

  return (
    <AppShell active="pending" counts={counts} siteName={siteName}>
      <div className={"qj-pageTitleRow"}>
        <h1>待批</h1>
        <p className={"qj-listHint"}>
          {counts.approval} 件未处理 · {ONE_BY_ONE_HINT}
        </p>
      </div>
      <ItemList items={items} emptyText="没有待批事项" />
    </AppShell>
  );
}
