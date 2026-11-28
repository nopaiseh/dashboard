import { verifyAgentTokenStepUpBinding } from "@/lib/agent-token-stepup";
import { requireSession } from "@/lib/auth-guard";
import {
  MIGRATE_GOALS_WEB_ENABLED,
  MigrateGoalsBusyError,
  auditMigrateGoalsWeb,
  executeGoalsMigration,
  isGoalsMigrationComplete,
  planGoalsMigration,
  verifyGoalsMigration,
  withMigrateExecuteLock,
} from "@/lib/dashboard/migrate-goals";
import { clientIp, jsonError, jsonOkNoStore } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { consumePasskeyAssertion } from "@/lib/passkey-step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import { migrateGoalsWebSchema } from "@/lib/validation";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/admin/migrate-goals
 * One-time owner-only goals → dashboard_blocks migration (plan | execute).
 * Unauthenticated / disabled / already-complete → 404 (do not advertise).
 */
export async function POST(request: Request) {
  await requireRequest();

  if (!MIGRATE_GOALS_WEB_ENABLED) {
    return jsonError(404, "not found");
  }

  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }

  const session = await requireSession();
  if (!session.ok) {
    return jsonError(404, "not found");
  }

  const rate = checkRateLimit(
    `admin-migrate-goals:${clientIp(request)}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!rate.allowed) {
    return jsonError(429, "rate limit exceeded", {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = migrateGoalsWebSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body");
  }

  const stepAction =
    parsed.data.action === "plan"
      ? "migrate_goals_plan"
      : "migrate_goals_execute";

  const bindingOk = await verifyAgentTokenStepUpBinding(parsed.data.binding, {
    challengeId: parsed.data.challenge_id,
    action: stepAction,
  });
  if (!bindingOk) {
    return jsonError(400, "invalid binding");
  }

  const supabase = getServiceClient();

  try {
    if (await isGoalsMigrationComplete(supabase)) {
      return jsonError(404, "not found");
    }
  } catch {
    return jsonError(500, "unavailable");
  }

  const passkey = await consumePasskeyAssertion({
    supabase,
    challengeId: parsed.data.challenge_id,
    purpose: "login",
    assertion: parsed.data.assertion,
  });
  if (!passkey.ok) {
    return jsonError(passkey.status, passkey.error);
  }

  if (parsed.data.action === "plan") {
    try {
      const plan = await planGoalsMigration(supabase);
      auditMigrateGoalsWeb({
        action: "plan",
        credential_id: passkey.credentialId,
        scanned: plan.scanned,
        skippedMigrated: plan.skippedMigrated,
        wouldUpsert: plan.wouldUpsert,
      });
      return jsonOkNoStore({
        action: "plan",
        scanned: plan.scanned,
        skipped_migrated: plan.skippedMigrated,
        would_upsert: plan.wouldUpsert,
        errors: plan.errors,
      });
    } catch {
      return jsonError(500, "plan failed");
    }
  }

  try {
    const result = await withMigrateExecuteLock(async () => {
      const counts = await executeGoalsMigration(supabase);
      const verify = await verifyGoalsMigration(supabase);
      return { counts, verify };
    });

    auditMigrateGoalsWeb({
      action: "execute",
      credential_id: passkey.credentialId,
      scanned: result.counts.scanned,
      inserted: result.counts.inserted,
      skippedMigrated: result.counts.skippedMigrated,
      conflictSkip: result.counts.conflictSkip,
      wouldUpsert: result.counts.wouldUpsert,
      verifyOk: result.verify.ok,
    });

    return jsonOkNoStore({
      action: "execute",
      scanned: result.counts.scanned,
      skipped_migrated: result.counts.skippedMigrated,
      would_upsert: result.counts.wouldUpsert,
      inserted: result.counts.inserted,
      conflict_skip: result.counts.conflictSkip,
      errors: result.counts.errors,
      verify: {
        goals: result.verify.goalsCount,
        blocks_expected: result.verify.blocksExpected,
        missing: result.verify.missingCount,
        decrypt_ok: result.verify.decryptOk,
        decrypt_failed: result.verify.decryptFailed,
        ok: result.verify.ok,
      },
    });
  } catch (err) {
    if (err instanceof MigrateGoalsBusyError) {
      return jsonError(409, "migration in progress");
    }
    return jsonError(500, "execute failed");
  }
}
