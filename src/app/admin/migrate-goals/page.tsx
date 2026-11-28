import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/qingjian/AppShell";
import { MigrateGoalsPanel } from "@/components/qingjian/MigrateGoalsPanel";
import { requireSession } from "@/lib/auth-guard";
import {
  MIGRATE_GOALS_WEB_ENABLED,
  isGoalsMigrationComplete,
} from "@/lib/dashboard/migrate-goals";
import { getServiceClient } from "@/lib/supabase/server";
import { loadShellData, withUiReadGuard } from "@/lib/ui/page-helpers";

export const instant = false;

export const metadata: Metadata = {
  title: "迁移 goals",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

/**
 * One-time owner-only migration UI. Removed in a follow-up PR.
 * Kill switch: MIGRATE_GOALS_WEB_ENABLED or migration already complete → 404.
 */
export default async function MigrateGoalsAdminPage() {
  await connection();

  if (!MIGRATE_GOALS_WEB_ENABLED) {
    notFound();
  }

  return withUiReadGuard(async () => {
    const session = await requireSession();
    if (!session.ok) {
      notFound();
    }

    const supabase = getServiceClient();
    try {
      if (await isGoalsMigrationComplete(supabase)) {
        notFound();
      }
    } catch {
      notFound();
    }

    const { siteName, counts } = await loadShellData();

    return (
      <AppShell active="settings" counts={counts} siteName={siteName}>
        <div className={"qj-pageTitleRow"}>
          <h1>迁移 goals → blocks</h1>
        </div>
        <MigrateGoalsPanel />
      </AppShell>
    );
  });
}
