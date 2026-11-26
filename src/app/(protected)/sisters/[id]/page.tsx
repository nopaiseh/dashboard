import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/qingjian/AppShell";
import { ItemList } from "@/components/qingjian/ItemList";
import { isValidUuid, loadItemsForAgent } from "@/lib/read";
import { loadShellData } from "@/lib/ui/page-helpers";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export default async function SisterDetailPage({ params }: PageProps) {
  await connection();
  const { id } = await params;
  if (!isValidUuid(id)) {
    notFound();
  }

  const { siteName, counts } = await loadShellData();
  const result = await loadItemsForAgent(id);
  if (!result) notFound();

  return (
    <AppShell active="sisters" counts={counts} siteName={siteName}>
      <div className={"qj-pageTitleRow"}>
        <h1>{result.agent.name}</h1>
      </div>
      <ItemList items={result.items} emptyText="这位姐妹暂无事项" />
    </AppShell>
  );
}
