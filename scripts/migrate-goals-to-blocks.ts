/**
 * One-off: migrate goals → dashboard progress blocks (encrypted payload).
 *
 * Cannot run encryption in SQL — FIELD_ENCRYPTION_KEY lives only in the app.
 * Default is --dry-run. Idempotent: block ids are deterministic from goals.id.
 *
 * Env (process.env; never printed):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — required
 *   FIELD_ENCRYPTION_KEY (or KEY_Vn / KEYS + CURRENT) — required
 * Load via shell, e.g. `set -a && source .env.local && set +a` then:
 *   npx tsx scripts/migrate-goals-to-blocks.ts
 *   npx tsx scripts/migrate-goals-to-blocks.ts --execute
 *   npx tsx scripts/migrate-goals-to-blocks.ts --execute --batch-size=50
 *
 * Does NOT delete goals. goals is already read-only after the schema migration.
 * Writes go through migrate_dashboard_progress_block (section+block+event txn).
 */

import { createClient } from "@supabase/supabase-js";
import { parseMigrateGoalsArgs } from "../src/lib/dashboard/migrate-goals-cli";
import {
  runGoalsMigration,
  verifyGoalsMigration,
} from "../src/lib/dashboard/migrate-goals";

async function main(): Promise<void> {
  const { dryRun, batchSize } = parseMigrateGoalsArgs(process.argv.slice(2));

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log(
    `[migrate-goals-to-blocks] dryRun=${dryRun} batchSize=${batchSize}`,
  );

  const counts = await runGoalsMigration(supabase, {
    dryRun,
    batchSize,
    hooks: {
      onDryRunUpsert: ({ goalId, blockId }) => {
        console.log(
          `[dry-run] would migrate goal id=${goalId} → block id=${blockId}`,
        );
      },
      onExecute: ({ goalId, blockId, result }) => {
        if (result === "already_migrated") {
          console.log(`[execute] already migrated block id=${blockId}`);
          return;
        }
        console.log(
          `[execute] migrated goal id=${goalId} → block id=${blockId}`,
        );
      },
      onError: ({ blockId, code }) => {
        console.error("migrate_dashboard_progress_block failed", {
          blockId: blockId ?? null,
          code,
        });
      },
    },
  });

  console.log(
    `[migrate-goals-to-blocks] done scanned=${counts.scanned} skippedMigrated=${counts.skippedMigrated} conflictSkip=${counts.conflictSkip} wouldUpsert=${counts.wouldUpsert} inserted=${counts.inserted}`,
  );

  if (!dryRun) {
    const verify = await verifyGoalsMigration(supabase);
    if (!verify.ok) {
      if (verify.missingCount > 0) {
        console.error(
          `[migrate-goals-to-blocks] verify mismatch: goals=${verify.goalsCount} missingBlocks=${verify.missingCount}`,
        );
        for (const id of verify.missingBlockIds) {
          console.error(`[migrate-goals-to-blocks] missing block id=${id}`);
        }
        throw new Error("verify failed: not every goal has a progress block");
      }
      for (const id of verify.decryptFailedBlockIds) {
        console.error(
          `[migrate-goals-to-blocks] verify decrypt failed block id=${id}`,
        );
      }
      throw new Error(
        `verify failed: ${verify.decryptFailed} block(s) could not be decrypted`,
      );
    }
    console.log(
      `[migrate-goals-to-blocks] verify ok goals=${verify.goalsCount} blocks=${verify.blocksExpected} decrypted=${verify.decryptOk}`,
    );
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "unknown error";
  console.error(`[migrate-goals-to-blocks] failed: ${message}`);
  process.exitCode = 1;
});
