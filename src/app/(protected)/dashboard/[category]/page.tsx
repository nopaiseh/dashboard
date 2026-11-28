import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/qingjian/AppShell";
import { DashboardDetailHeader } from "@/components/qingjian/DashboardDetailHeader";
import { DashboardView } from "@/components/qingjian/DashboardView";
import { findSectionByCategory } from "@/components/qingjian/dashboard/boardSummary";
import { loadDashboard } from "@/lib/read";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

/** 与 layout 一致：全动态，避免 PPR 静态部分缺 nonce。 */
export const instant = false;

type PageProps = {
  params: Promise<{ category: string }>;
};

function sectionHeadline(
  blocks: { block_type: string; payload: Record<string, unknown> }[],
): string {
  const hit = blocks.find((b) => b.block_type === "headline");
  const text = hit?.payload.text;
  return typeof text === "string" ? text : "";
}

export default async function DashboardCategoryPage({ params }: PageProps) {
  await connection();
  const { category } = await params;
  if (!category?.trim()) {
    notFound();
  }

  return withUiReadGuard(async () => {
    const { siteName, counts } = await loadShellData();
    const dashboard = await loadDashboard();
    const section = findSectionByCategory(dashboard.sections, category);
    if (!section) {
      notFound();
    }

    return (
      <AppShell active="today" counts={counts} siteName={siteName}>
        <DashboardDetailHeader />
        <DashboardView
          data={{
            headline: sectionHeadline(section.blocks),
            sections: [section],
          }}
        />
      </AppShell>
    );
  });
}
