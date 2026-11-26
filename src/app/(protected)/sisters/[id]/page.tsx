import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/qingjian/AppShell";
import { ItemList } from "@/components/qingjian/ItemList";
import {
  loadAgents,
  loadAllItems,
  type ItemWithMeta,
} from "@/lib/ui/data";
import { hasInvalidatedApproval } from "@/lib/ui/invalidation";
import { getServiceClient } from "@/lib/supabase/server";
import type { ItemEventRow, ItemRow } from "@/lib/types";
import { loadShellData } from "@/lib/ui/page-helpers";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export default async function SisterDetailPage({ params }: PageProps) {
  await connection();
  const { id } = await params;
  const { siteName, counts } = await loadShellData();

  const agents = await loadAgents();
  const agent = agents.find((a) => a.id === id);
  if (!agent) notFound();

  const all = await loadAllItems();
  const owned = all.filter((i) => i.agent_id === id);
  const supabase = getServiceClient();
  const openApprovals = owned.filter(
    (i) => i.status === "open" && i.kind === "approval",
  );
  const invalidated = new Set<string>();
  if (openApprovals.length) {
    const { data, error } = await supabase
      .from("item_events")
      .select("item_id, action, content_hash")
      .in(
        "item_id",
        openApprovals.map((i) => i.id),
      )
      .eq("action", "approve");
    if (error) {
      throw new Error("failed to load item events");
    }
    const byItem = new Map<string, ItemEventRow[]>();
    for (const row of (data ?? []) as ItemEventRow[]) {
      const list = byItem.get(row.item_id) ?? [];
      list.push(row);
      byItem.set(row.item_id, list);
    }
    for (const item of openApprovals) {
      if (hasInvalidatedApproval(item, byItem.get(item.id) ?? [])) {
        invalidated.add(item.id);
      }
    }
  }

  const items: ItemWithMeta[] = owned.map((item: ItemRow) => ({
    ...item,
    agent_name: agent.name,
    agent_area: agent.area,
    invalidated_approval: invalidated.has(item.id),
  }));

  return (
    <AppShell active="sisters" counts={counts} siteName={siteName}>
      <div className={"qj-pageTitleRow"}>
        <h1>{agent.name}</h1>
      </div>
      <ItemList items={items} emptyText="这位姐妹暂无事项" />
    </AppShell>
  );
}
