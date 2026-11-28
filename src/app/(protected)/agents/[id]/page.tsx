import { connection } from "next/server";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/qingjian/AppShell";
import { AgentDetailTabs } from "@/components/qingjian/AgentDetailTabs";
import { AgentTokensPanel } from "@/components/qingjian/AgentTokensPanel";
import { ItemList } from "@/components/qingjian/ItemList";
import { listAgentsWithTokens } from "@/lib/owner-agent-tokens";
import { isValidUuid, loadItemsForAgent } from "@/lib/read";
import { getServiceClient } from "@/lib/supabase/server";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

export const instant = false;

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AgentDetailPage({ params }: PageProps) {
  await connection();
  const { id } = await params;
  if (!isValidUuid(id)) {
    notFound();
  }

  return withUiReadGuard(async () => {
    const { siteName, counts } = await loadShellData();
    const result = await loadItemsForAgent(id);
    if (!result) notFound();

    const agentsWithTokens = await listAgentsWithTokens(getServiceClient());
    const agentTokens = agentsWithTokens.filter((a) => a.id === id);

    return (
      <AppShell active="agents" counts={counts} siteName={siteName}>
        <div className={"qj-pageTitleRow"}>
          <h1>{result.agent.name}</h1>
        </div>
        <Suspense fallback={<p className={"qj-listHint"}>加载中…</p>}>
          <AgentDetailTabs
            itemsPanel={
              <ItemList items={result.items} emptyText="这位专员暂无事项" />
            }
            tokensPanel={
              <AgentTokensPanel initialAgents={agentTokens} agentId={id} />
            }
          />
        </Suspense>
      </AppShell>
    );
  });
}
