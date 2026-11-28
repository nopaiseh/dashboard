import { connection } from "next/server";
import { AppShell } from "@/components/qingjian/AppShell";
import { DashboardView } from "@/components/qingjian/DashboardView";
import { loadDashboard } from "@/lib/read";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

/** 与 layout 一致：全动态，避免 PPR 静态部分缺 nonce。 */
export const instant = false;

export default async function HomePage() {
  await connection();
  return withUiReadGuard(async () => {
    const { siteName, counts } = await loadShellData();
    const dashboard = await loadDashboard();

    return (
      <AppShell active="today" counts={counts} siteName={siteName}>
        <DashboardView data={dashboard} />
      </AppShell>
    );
  });
}
