/**
 * One-off: migrate goals → dashboard progress blocks (encrypted payload).
 *
 * Cannot run encryption in SQL — FIELD_ENCRYPTION_KEY lives only in the app.
 * Default is --dry-run. Idempotent: block ids are deterministic from goals.id.
 *
 * Usage:
 *   npx tsx scripts/migrate-goals-to-blocks.ts
 *   npx tsx scripts/migrate-goals-to-blocks.ts --execute
 *   npx tsx scripts/migrate-goals-to-blocks.ts --execute --batch-size=50
 *
 * Does NOT delete goals. goals is already read-only after the schema migration.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { encryptBlockPayload } from "../src/lib/dashboard/crypto";
import { parseMigrateGoalsArgs } from "../src/lib/dashboard/migrate-goals-cli";
import {
  planGoalMigration,
  type LegacyGoalRow,
} from "../src/lib/dashboard/migrate-goals-plan";
import { resetFieldKeyringCache } from "../src/lib/crypto/fields-core";
import { encryptField } from "../src/lib/crypto/fields-core";

async function loadExistingBlockIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  if (ids.length === 0) return found;
  // PostgREST `.in` — chunk to stay under URL limits
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

async function findSectionId(
  supabase: SupabaseClient,
  category: string,
  agentId: string | null,
): Promise<string | null> {
  let query = supabase
    .from("dashboard_sections")
    .select("id")
    .eq("category", category)
    .limit(1);
  query =
    agentId === null
      ? query.is("agent_id", null)
      : query.eq("agent_id", agentId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`failed to look up section category=${category}`);
  }
  return data?.id ? (data.id as string) : null;
}

/**
 * Prefer an existing section for (category, agent_id); otherwise insert
 * with the deterministic id from the plan.
 */
async function ensureSection(
  supabase: SupabaseClient,
  section: {
    id: string;
    category: string;
    sort_order: number;
    agent_id: string | null;
  },
): Promise<string> {
  const existingId = await findSectionId(
    supabase,
    section.category,
    section.agent_id,
  );
  if (existingId) return existingId;

  const { error } = await supabase.from("dashboard_sections").insert({
    id: section.id,
    category: section.category,
    sort_order: section.sort_order,
    agent_id: section.agent_id,
  });
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const again = await findSectionId(
        supabase,
        section.category,
        section.agent_id,
      );
      if (!again) {
        throw new Error("failed to resolve section after conflict");
      }
      return again;
    }
    throw new Error(`failed to insert section id=${section.id}`);
  }
  return section.id;
}

async function insertBlock(
  supabase: SupabaseClient,
  block: {
    id: string;
    section_id: string;
    block_type: "progress";
    sort_order: number;
    agent_id: string | null;
    payload: string;
  },
): Promise<"inserted" | "conflict_skip"> {
  const { error } = await supabase.from("dashboard_blocks").insert(block);
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return "conflict_skip";
    }
    throw new Error(`failed to insert block id=${block.id}`);
  }

  await supabase.from("dashboard_block_events").insert({
    block_id: block.id,
    actor_type: "agent",
    agent_id: block.agent_id,
    action: "create",
  });

  return "inserted";
}

async function main(): Promise<void> {
  const { dryRun, batchSize } = parseMigrateGoalsArgs(process.argv.slice(2));
  resetFieldKeyringCache();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  // Probe encryption key before touching data
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

      const sectionId = await ensureSection(supabase, plan.section);
      const encrypted = encryptBlockPayload(plan.block.id, plan.block.payload);
      const result = await insertBlock(supabase, {
        id: plan.block.id,
        section_id: sectionId,
        block_type: plan.block.block_type,
        sort_order: plan.block.sort_order,
        agent_id: plan.block.agent_id,
        payload: encrypted,
      });
      if (result === "conflict_skip") {
        conflictSkip += 1;
        console.log(`[execute] conflict skip block id=${plan.block.id}`);
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
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "unknown error";
  console.error(`[migrate-goals-to-blocks] failed: ${message}`);
  process.exitCode = 1;
});
