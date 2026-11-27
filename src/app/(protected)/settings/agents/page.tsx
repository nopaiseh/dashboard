import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/qingjian/AppShell";
import { AgentTokensPanel } from "@/components/qingjian/AgentTokensPanel";
import { requireSession } from "@/lib/auth-guard";
import { listAgentsWithTokens } from "@/lib/owner-agent-tokens";
import { getServiceClient } from "@/lib/supabase/server";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function OwnerAgentTokensPage() {
  await connection();
  return withUiReadGuard(async () => {
    const session = await requireSession();
    if (!session.ok) {
      redirect("/login");
    }

    const { siteName, counts } = await loadShellData();
    const agents = await listAgentsWithTokens(getServiceClient());

    return (
      <AppShell active="settings" counts={counts} siteName={siteName}>
        <div className={"qj-pageTitleRow"}>
          <h1>姐妹令牌</h1>
        </div>
        <AgentTokensPanel initialAgents={agents} />
      </AppShell>
    );
  });
}
