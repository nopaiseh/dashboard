import { connection } from "next/server";
import Link from "next/link";
import { AppShell } from "@/components/qingjian/AppShell";
import { loadSisterCards } from "@/lib/ui/data";
import { loadShellData } from "@/lib/ui/page-helpers";

export const instant = false;

export default async function SistersPage() {
  await connection();
  const { siteName, counts } = await loadShellData();
  const sisters = await loadSisterCards();

  return (
    <AppShell active="sisters" counts={counts} siteName={siteName}>
      <div className={"qj-pageTitleRow"}>
        <h1>姐妹</h1>
      </div>
      {sisters.length === 0 ? (
        <p className={"qj-empty"}>暂无姐妹资料</p>
      ) : (
        <div className={"qj-sistersGrid"}>
          {sisters.map(({ agent, summary }) => (
            <Link
              key={agent.id}
              href={`/sisters/${agent.id}`}
              className={"qj-card"}
            >
              <h3>{agent.name}</h3>
              <div className={"qj-role"}>{agent.area || agent.slug}</div>
              <div className={"qj-role"}>{summary}</div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
