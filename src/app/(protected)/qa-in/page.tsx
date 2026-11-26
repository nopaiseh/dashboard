import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { ItemList } from "@/components/qingjian/ItemList";
import { loadItemsByKind } from "@/lib/read";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function QaInPage() {
  await connection();
  return withUiReadGuard(async () => {
    const { siteName, counts } = await loadShellData();
    const items = await loadItemsByKind("question_to_user", "open");

    return (
      <AppShell active="qa-in" counts={counts} siteName={siteName}>
        <div className={"qj-pageTitleRow"}>
          <h1>问你的</h1>
        </div>
        <ItemList items={items} emptyText="没有问你的事项" />
      </AppShell>
    );
  });
}
