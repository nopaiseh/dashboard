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
import {
  clientIp,
  jsonErrorNoStore,
  jsonOkNoStore,
} from "@/lib/http";
import {
  createMigrateGoalsCsrfToken,
  verifyMigrateGoalsCsrfToken,
} from "@/lib/migrate-goals-csrf";
import {
  MIGRATE_GOALS_STEPUP_COOKIE,
  MIGRATE_GOALS_STEPUP_TTL_MS,
  createMigrateGoalsStepUpToken,
  migrateGoalsStepUpCookieOptions,
  verifyMigrateGoalsStepUpToken,
} from "@/lib/migrate-goals-stepup";
import { assertSameOrigin } from "@/lib/origin";
import { consumePasskeyAssertion } from "@/lib/passkey-step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import { migrateGoalsWebSchema } from "@/lib/validation";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * POST /api/admin/migrate-goals
 * One-time owner-only goals → dashboard_blocks migration (plan | execute).
 * Unauthenticated / disabled / already-complete → 404 (do not advertise).
 * All responses: Cache-Control: no-store.
 */
export async function POST(request: Request) {
  await requireRequest();

  if (!MIGRATE_GOALS_WEB_ENABLED) {
    return jsonErrorNoStore(404, "not found");
  }

  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonErrorNoStore(403, origin.error);
  }

  const session = await requireSession();
  if (!session.ok) {
    return jsonErrorNoStore(404, "not found");
  }

  const rate = checkRateLimit(
    `admin-migrate-goals:${clientIp(request)}`,
    RATE_LIMIT,
    RATE_WINDOW_MS,
  );
  if (!rate.allowed) {
    return jsonErrorNoStore(429, "rate limit exceeded", {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonErrorNoStore(400, "invalid json");
  }

  const parsed = migrateGoalsWebSchema.safeParse(body);
  if (!parsed.success) {
    return jsonErrorNoStore(400, "invalid body");
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
    return jsonErrorNoStore(400, "invalid binding");
  }

  const supabase = getServiceClient();

  try {
    if (await isGoalsMigrationComplete(supabase)) {
      return jsonErrorNoStore(404, "not found");
    }
  } catch {
    return jsonErrorNoStore(500, "unavailable");
  }

  const passkey = await consumePasskeyAssertion({
    supabase,
    challengeId: parsed.data.challenge_id,
    purpose: "login",
    assertion: parsed.data.assertion,
  });
  if (!passkey.ok) {
    return jsonErrorNoStore(passkey.status, passkey.error);
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

      const csrfToken = await createMigrateGoalsCsrfToken({
        planChallengeId: parsed.data.challenge_id,
      });
      const stepUpToken = await createMigrateGoalsStepUpToken({
        credentialId: passkey.credentialId,
        planChallengeId: parsed.data.challenge_id,
      });

      const response = NextResponse.json(
        {
          action: "plan",
          to_migrate: plan.wouldUpsert,
          already_existing: plan.skippedMigrated,
          scanned: plan.scanned,
          errors: plan.errors,
          csrf_token: csrfToken,
          plan_challenge_id: parsed.data.challenge_id,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
      response.cookies.set(
        MIGRATE_GOALS_STEPUP_COOKIE,
        stepUpToken,
        migrateGoalsStepUpCookieOptions(
          Math.floor(MIGRATE_GOALS_STEPUP_TTL_MS / 1000),
        ),
      );
      return response;
    } catch {
      return jsonErrorNoStore(500, "plan failed");
    }
  }

  // Execute: require recent dry-run step-up cookie + CSRF + confirm:true + fresh passkey
  const jar = await cookies();
  const recent = jar.get(MIGRATE_GOALS_STEPUP_COOKIE)?.value;
  if (!recent) {
    return jsonErrorNoStore(404, "not found");
  }
  const recentOk = await verifyMigrateGoalsStepUpToken(recent);
  if (!recentOk.ok) {
    return jsonErrorNoStore(404, "not found");
  }

  const csrfOk = await verifyMigrateGoalsCsrfToken(parsed.data.csrf_token, {
    planChallengeId: parsed.data.plan_challenge_id,
  });
  if (!csrfOk) {
    return jsonErrorNoStore(400, "invalid csrf");
  }
  if (recentOk.planChallengeId !== parsed.data.plan_challenge_id) {
    return jsonErrorNoStore(400, "invalid csrf");
  }

  // confirm is z.literal(true) in schema — still assert for clarity
  if (parsed.data.confirm !== true) {
    return jsonErrorNoStore(400, "confirm required");
  }

  try {
    const result = await withMigrateExecuteLock(supabase, async () => {
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
      to_migrate: result.counts.wouldUpsert,
      already_existing: result.counts.skippedMigrated,
      scanned: result.counts.scanned,
      inserted: result.counts.inserted,
      conflict_skip: result.counts.conflictSkip,
      errors: result.counts.errors,
      verify: {
        counts_match:
          result.verify.missingCount === 0 &&
          result.verify.goalsCount === result.verify.blocksExpected,
        goals: result.verify.goalsCount,
        blocks_expected: result.verify.blocksExpected,
        missing: result.verify.missingCount,
        missing_ids: result.verify.missingBlockIds,
        decrypt_ok: result.verify.decryptOk,
        decrypt_failed: result.verify.decryptFailed,
        decrypt_failed_ids: result.verify.decryptFailedBlockIds,
        ok: result.verify.ok,
      },
    });
  } catch (err) {
    if (err instanceof MigrateGoalsBusyError) {
      return jsonErrorNoStore(409, "migration in progress");
    }
    return jsonErrorNoStore(500, "execute failed");
  }
}
