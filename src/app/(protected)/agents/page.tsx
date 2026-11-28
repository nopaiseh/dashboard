import { connection } from "next/server";
import Link from "next/link";
import { AppShell } from "@/components/qingjian/AppShell";
import { CreateAgentForm } from "@/components/qingjian/CreateAgentForm";
import { loadSisterCards } from "@/lib/read";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function AgentsPage() {
  await connection();
  return withUiReadGuard(async () => {
    const { siteName, counts } = await loadShellData();
    const agents = await loadSisterCards();

    return (
      <AppShell active="agents" counts={counts} siteName={siteName}>
        <div className={"qj-pageTitleRow"}>
          <h1>专员</h1>
        </div>
        {agents.length === 0 ? (
          <p className={"qj-empty"}>暂无专员资料</p>
        ) : (
          <div className={"qj-agentsGrid"}>
            {agents.map(({ agent, summary }) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}`}
                className={"qj-card"}
              >
                <h3>{agent.name}</h3>
                <div className={"qj-role"}>{agent.area || agent.slug}</div>
                <div className={"qj-role"}>{summary}</div>
              </Link>
            ))}
          </div>
        )}
        <CreateAgentForm />
      </AppShell>
    );
  });
}
