import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { ItemList } from "@/components/qingjian/ItemList";
import { loadItemsByKind } from "@/lib/read";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function WaitingPage() {
  await connection();
  return withUiReadGuard(async () => {
    const { siteName, counts } = await loadShellData();
    const items = await loadItemsByKind("waiting", "open");

    return (
      <AppShell active="waiting" counts={counts} siteName={siteName}>
        <div className={"qj-pageTitleRow"}>
          <h1>待回音</h1>
        </div>
        <ItemList items={items} emptyText="没有待回音的事项" />
      </AppShell>
    );
  });
}
