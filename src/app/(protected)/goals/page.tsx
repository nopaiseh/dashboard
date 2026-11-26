import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { ProgressBar } from "@/components/qingjian/ProgressBar";
import { loadGoals } from "@/lib/read";
import { progressPercent } from "@/lib/ui/format";
import { loadShellData } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function GoalsPage() {
  await connection();
  const { siteName, counts } = await loadShellData();
  const goals = await loadGoals();

  return (
    <AppShell active="goals" counts={counts} siteName={siteName}>
      <div className={"qj-pageTitleRow"}>
        <h1>目标</h1>
      </div>
      {goals.length === 0 ? (
        <p className={"qj-empty"}>暂无目标</p>
      ) : (
        <div className={"qj-goals"}>
          {goals.map((g) => (
            <article key={g.id} className={"qj-card"}>
              <h3>{g.title || g.area}</h3>
              <div className={"qj-role"}>
                {[g.agent_name, g.target].filter(Boolean).join(" · ")}
              </div>
              {g.metric ? <p>{g.metric}</p> : null}
              <ProgressBar
                value={progressPercent(g.progress)}
                label={g.title || g.area}
              />
            </article>
          ))}
        </div>
      )}
    </AppShell>
  );
}
