import type { Metadata } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/qingjian/AppShell";
import { MigrateGoalsPanel } from "@/components/qingjian/MigrateGoalsPanel";
import { requireSession } from "@/lib/auth-guard";
import {
  MIGRATE_GOALS_WEB_ENABLED,
  isGoalsMigrationComplete,
} from "@/lib/dashboard/migrate-goals";
import {
  MIGRATE_GOALS_STEPUP_COOKIE,
  verifyMigrateGoalsStepUpToken,
} from "@/lib/migrate-goals-stepup";
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
 * One-time owner-only migration UI. Deleted in the next release after migration.
 * Server-side owner check; dry-run requires recent passkey step-up (panel).
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

    const jar = await cookies();
    const stepUpCookie = jar.get(MIGRATE_GOALS_STEPUP_COOKIE)?.value;
    const recentStepUp = stepUpCookie
      ? await verifyMigrateGoalsStepUpToken(stepUpCookie)
      : { ok: false as const };
    const hasRecentStepUp = recentStepUp.ok;

    const { siteName, counts } = await loadShellData();

    return (
      <AppShell active="settings" counts={counts} siteName={siteName}>
        <div className={"qj-pageTitleRow"}>
          <h1>迁移 goals → blocks</h1>
        </div>
        <MigrateGoalsPanel hasRecentStepUp={hasRecentStepUp} />
      </AppShell>
    );
  });
}
