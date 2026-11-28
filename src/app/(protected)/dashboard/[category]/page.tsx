import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/qingjian/AppShell";
import { DashboardDetailHeader } from "@/components/qingjian/DashboardDetailHeader";
import { DashboardView } from "@/components/qingjian/DashboardView";
import {
  findSectionsByCategory,
  sectionsHeadline,
} from "@/components/qingjian/dashboard/boardSummary";
import { loadDashboard } from "@/lib/read";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

/** 与 layout 一致：全动态，避免 PPR 静态部分缺 nonce。 */
export const instant = false;

type PageProps = {
  params: Promise<{ category: string }>;
};

export default async function DashboardCategoryPage({ params }: PageProps) {
  await connection();
  const { category } = await params;
  if (!category?.trim()) {
    notFound();
  }

  return withUiReadGuard(async () => {
    const { siteName, counts } = await loadShellData();
    const dashboard = await loadDashboard();
    const matched = findSectionsByCategory(dashboard.sections, category);
    if (matched.length === 0) {
      notFound();
    }

    return (
      <AppShell active="today" counts={counts} siteName={siteName}>
        <DashboardDetailHeader />
        <DashboardView
          data={{
            headline: sectionsHeadline(matched),
            sections: matched,
          }}
        />
      </AppShell>
    );
  });
}
