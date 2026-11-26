import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { TodayView } from "@/components/qingjian/TodayView";
import {
  loadGoals,
  loadHeldItems,
  loadLatestSummary,
  loadOpenApprovals,
  loadSisterCards,
} from "@/lib/ui/data";
import { loadShellData } from "@/lib/ui/page-helpers";

/** 与 layout 一致：全动态，避免 PPR 静态部分缺 nonce。 */
export const instant = false;

export default async function HomePage() {
  await connection();
  const { siteName, counts } = await loadShellData();

  let summary: string | null = null;
  let goals: Array<{ id: string; title: string; role: string; progress: number }> =
    [];
  const pending = await safe(() => loadOpenApprovals(5), []);
  let heldPreview = "查看超过 7 天无动静的事项";
  let sistersPreview = "按负责姐妹浏览待办与问答";

  try {
    const [sum, goalRows, held, sisters] = await Promise.all([
      loadLatestSummary(),
      loadGoals(),
      loadHeldItems(),
      loadSisterCards(),
    ]);
    summary = sum?.content ?? null;
    goals = goalRows.slice(0, 3).map((g) => ({
      id: g.id,
      title: g.title || g.area || "目标",
      role: [g.agent_name, g.target].filter(Boolean).join(" · ") || g.metric || "",
      progress: Number(g.progress) || 0,
    }));
    if (held[0]) {
      heldPreview = `例如：${held[0].title}`;
    } else if (counts.held === 0) {
      heldPreview = "当前没有搁置事项";
    }
    const busy = sisters.filter((s) => s.openCount > 0).slice(0, 3);
    if (busy.length) {
      sistersPreview = busy
        .map((s) => `${s.agent.name}（${s.summary}）`)
        .join("；");
    }
  } catch {
    // 空数据兜底
  }

  return (
    <AppShell active="today" counts={counts} siteName={siteName}>
      <TodayView
        summary={summary}
        counts={counts}
        goals={goals}
        pending={pending}
        heldPreview={heldPreview}
        sistersPreview={sistersPreview}
      />
    </AppShell>
  );
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
