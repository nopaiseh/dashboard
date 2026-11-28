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

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  decryptBlockPayloadStrict,
  encryptBlockPayload,
} from "../src/lib/dashboard/crypto";
import { parseMigrateGoalsArgs } from "../src/lib/dashboard/migrate-goals-cli";
import {
  planGoalMigration,
  type LegacyGoalRow,
} from "../src/lib/dashboard/migrate-goals-plan";
import { blockIdForGoal } from "../src/lib/dashboard/ids";
import {
  encryptField,
  resetFieldKeyringCache,
} from "../src/lib/crypto/fields-core";

async function loadExistingBlockIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  if (ids.length === 0) return found;
  const chunkSize = 100;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("dashboard_blocks")
      .select("id")
      .in("id", chunk);
    if (error) {
      throw new Error("failed to load existing dashboard_blocks ids");
    }
    for (const row of data ?? []) {
      found.add((row as { id: string }).id);
    }
  }
  return found;
}

async function migrateOne(
  supabase: SupabaseClient,
  plan: Extract<ReturnType<typeof planGoalMigration>, { action: "upsert" }>,
): Promise<"inserted" | "already_migrated"> {
  const encrypted = encryptBlockPayload(plan.block.id, plan.block.payload);
  const { data, error } = await supabase.rpc(
    "migrate_dashboard_progress_block",
    {
      p_preferred_section_id: plan.section.id,
      p_category: plan.section.category,
      p_section_sort_order: plan.section.sort_order,
      p_section_agent_id: plan.section.agent_id,
      p_block_id: plan.block.id,
      p_block_sort_order: plan.block.sort_order,
      p_block_agent_id: plan.block.agent_id,
      p_payload: encrypted,
    },
  );

  if (error) {
    console.error("migrate_dashboard_progress_block failed", {
      blockId: plan.block.id,
      code: (error as { code?: string }).code ?? "unknown",
    });
    throw new Error(`failed to migrate goal id=${plan.goalId}`);
  }

  const status = (data as { status?: string } | null)?.status;
  if (status === "already_migrated") return "already_migrated";
  if (status === "inserted") return "inserted";
  throw new Error(`unexpected migrate status for block id=${plan.block.id}`);
}

async function verifyMigration(supabase: SupabaseClient): Promise<void> {
  const { count: goalsCount, error: goalsError } = await supabase
    .from("goals")
    .select("id", { count: "exact", head: true });
  if (goalsError) {
    throw new Error("verify: failed to count goals");
  }

  const { data: goals, error: goalsLoadError } = await supabase
    .from("goals")
    .select("id")
    .order("id", { ascending: true });
  if (goalsLoadError) {
    throw new Error("verify: failed to load goal ids");
  }

  const expectedIds = ((goals ?? []) as Array<{ id: string }>).map((g) =>
    blockIdForGoal(g.id),
  );
  const existing = await loadExistingBlockIds(supabase, expectedIds);
  const missing = expectedIds.filter((id) => !existing.has(id));

  if (missing.length > 0) {
    console.error(
      `[migrate-goals-to-blocks] verify mismatch: goals=${goalsCount ?? 0} missingBlocks=${missing.length}`,
    );
    for (const id of missing.slice(0, 20)) {
      console.error(`[migrate-goals-to-blocks] missing block id=${id}`);
    }
    throw new Error("verify failed: not every goal has a progress block");
  }

  let decryptFailed = 0;
  const chunkSize = 100;
  for (let i = 0; i < expectedIds.length; i += chunkSize) {
    const chunk = expectedIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("dashboard_blocks")
      .select("id, payload")
      .in("id", chunk);
    if (error) {
      throw new Error("verify: failed to load blocks for decrypt check");
    }
    for (const row of (data ?? []) as Array<{ id: string; payload: string }>) {
      try {
        decryptBlockPayloadStrict(row);
      } catch {
        decryptFailed += 1;
        console.error(
          `[migrate-goals-to-blocks] verify decrypt failed block id=${row.id}`,
        );
      }
    }
  }

  if (decryptFailed > 0) {
    throw new Error(
      `verify failed: ${decryptFailed} block(s) could not be decrypted`,
    );
  }

  console.log(
    `[migrate-goals-to-blocks] verify ok goals=${goalsCount ?? 0} blocks=${expectedIds.length} decrypted=${expectedIds.length}`,
  );
}

async function main(): Promise<void> {
  const { dryRun, batchSize } = parseMigrateGoalsArgs(process.argv.slice(2));
  resetFieldKeyringCache();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  encryptField("__probe__", {
    itemId: "00000000-0000-4000-8000-000000000000",
    column: "payload",
    entity: "dashboard_blocks",
  });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let offset = 0;
  let scanned = 0;
  let skippedMigrated = 0;
  let wouldUpsert = 0;
  let inserted = 0;
  let conflictSkip = 0;

  console.log(
    `[migrate-goals-to-blocks] dryRun=${dryRun} batchSize=${batchSize}`,
  );

  for (;;) {
    const { data, error } = await supabase
      .from("goals")
      .select(
        "id, area, title, target, metric, progress, due_at, agent_id, status, updated_at",
      )
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw new Error(`failed to load goals batch at offset ${offset}`);
    }

    const rows = (data ?? []) as LegacyGoalRow[];
    if (rows.length === 0) break;

    const candidateIds = rows.map((g) => {
      const plan = planGoalMigration(g, new Set());
      return plan.action === "upsert" ? plan.block.id : plan.blockId;
    });
    const existing = await loadExistingBlockIds(supabase, candidateIds);

    for (const goal of rows) {
      scanned += 1;
      const plan = planGoalMigration(goal, existing);
      if (plan.action === "skip") {
        skippedMigrated += 1;
        continue;
      }

      wouldUpsert += 1;
      if (dryRun) {
        console.log(
          `[dry-run] would migrate goal id=${goal.id} → block id=${plan.block.id}`,
        );
        continue;
      }

      const result = await migrateOne(supabase, plan);
      if (result === "already_migrated") {
        conflictSkip += 1;
        existing.add(plan.block.id);
        console.log(`[execute] already migrated block id=${plan.block.id}`);
        continue;
      }
      inserted += 1;
      existing.add(plan.block.id);
      console.log(
        `[execute] migrated goal id=${goal.id} → block id=${plan.block.id}`,
      );
    }

    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  console.log(
    `[migrate-goals-to-blocks] done scanned=${scanned} skippedMigrated=${skippedMigrated} conflictSkip=${conflictSkip} wouldUpsert=${wouldUpsert} inserted=${inserted}`,
  );

  if (!dryRun) {
    await verifyMigration(supabase);
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "unknown error";
  console.error(`[migrate-goals-to-blocks] failed: ${message}`);
  process.exitCode = 1;
});
