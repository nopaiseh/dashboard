/**
 * Shared goals → dashboard_blocks migration core (CLI + one-time web UI).
 * Never logs plaintext payloads or encryption secrets — only counts, ids, error codes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  decryptBlockPayloadStrict,
  encryptBlockPayload,
} from "@/lib/dashboard/crypto";
import { blockIdForGoal } from "@/lib/dashboard/ids";
import {
  planGoalMigration,
  type LegacyGoalRow,
} from "@/lib/dashboard/migrate-goals-plan";
import {
  encryptField,
  resetFieldKeyringCache,
} from "@/lib/crypto/fields-core";

export type MigrateGoalsCounts = {
  scanned: number;
  skippedMigrated: number;
  wouldUpsert: number;
  inserted: number;
  conflictSkip: number;
  errors: number;
};

export type MigrateGoalsPlanResult = {
  scanned: number;
  skippedMigrated: number;
  wouldUpsert: number;
  errors: number;
};

export type MigrateGoalsVerifyResult = {
  goalsCount: number;
  blocksExpected: number;
  missingCount: number;
  /** First missing block ids (capped) for CLI logging — never payloads. */
  missingBlockIds: string[];
  decryptOk: number;
  decryptFailed: number;
  /** First decrypt-failed block ids (capped). */
  decryptFailedBlockIds: string[];
  ok: boolean;
};

export type MigrateGoalsHooks = {
  onDryRunUpsert?: (info: { goalId: string; blockId: string }) => void;
  onExecute?: (info: {
    goalId: string;
    blockId: string;
    result: "inserted" | "already_migrated";
  }) => void;
  onError?: (info: { goalId?: string; blockId?: string; code: string }) => void;
};

export type MigrateGoalsRunOptions = {
  dryRun: boolean;
  batchSize?: number;
  hooks?: MigrateGoalsHooks;
};

const DEFAULT_BATCH = 100;

/** Hard kill switch for the one-time web UI (flip false / delete page in follow-up). */
export const MIGRATE_GOALS_WEB_ENABLED = true;

export function assertEncryptionReady(): void {
  resetFieldKeyringCache();
  encryptField("__probe__", {
    itemId: "00000000-0000-4000-8000-000000000000",
    column: "payload",
    entity: "dashboard_blocks",
  });
}

export async function loadExistingBlockIds(
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
  hooks?: MigrateGoalsHooks,
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
    hooks?.onError?.({
      goalId: plan.goalId,
      blockId: plan.block.id,
      code: (error as { code?: string }).code ?? "rpc_error",
    });
    throw new Error(`failed to migrate goal id=${plan.goalId}`);
  }

  const status = (data as { status?: string } | null)?.status;
  if (status === "already_migrated") return "already_migrated";
  if (status === "inserted") return "inserted";
  throw new Error(`unexpected migrate status for block id=${plan.block.id}`);
}

/**
 * Plan (dry-run) or execute migration. Idempotent block ids (UUIDv5).
 * Dry-run performs no writes.
 */
export async function runGoalsMigration(
  supabase: SupabaseClient,
  options: MigrateGoalsRunOptions,
): Promise<MigrateGoalsCounts> {
  assertEncryptionReady();

  const batchSize = options.batchSize ?? DEFAULT_BATCH;
  const hooks = options.hooks;
  let offset = 0;
  const counts: MigrateGoalsCounts = {
    scanned: 0,
    skippedMigrated: 0,
    wouldUpsert: 0,
    inserted: 0,
    conflictSkip: 0,
    errors: 0,
  };

  for (;;) {
    const { data, error } = await supabase
      .from("goals")
      .select(
        "id, area, title, target, metric, progress, due_at, agent_id, status, updated_at",
      )
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      hooks?.onError?.({ code: "load_goals_failed" });
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
      counts.scanned += 1;
      const plan = planGoalMigration(goal, existing);
      if (plan.action === "skip") {
        counts.skippedMigrated += 1;
        continue;
      }

      counts.wouldUpsert += 1;
      if (options.dryRun) {
        hooks?.onDryRunUpsert?.({
          goalId: goal.id,
          blockId: plan.block.id,
        });
        continue;
      }

      try {
        const result = await migrateOne(supabase, plan, hooks);
        if (result === "already_migrated") {
          counts.conflictSkip += 1;
          existing.add(plan.block.id);
          hooks?.onExecute?.({
            goalId: goal.id,
            blockId: plan.block.id,
            result: "already_migrated",
          });
          continue;
        }
        counts.inserted += 1;
        existing.add(plan.block.id);
        hooks?.onExecute?.({
          goalId: goal.id,
          blockId: plan.block.id,
          result: "inserted",
        });
      } catch {
        counts.errors += 1;
        throw new Error(`failed to migrate goal id=${goal.id}`);
      }
    }

    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  return counts;
}

/** Dry-run: counts only; no writes. */
export async function planGoalsMigration(
  supabase: SupabaseClient,
  batchSize?: number,
): Promise<MigrateGoalsPlanResult> {
  const counts = await runGoalsMigration(supabase, {
    dryRun: true,
    batchSize,
  });
  return {
    scanned: counts.scanned,
    skippedMigrated: counts.skippedMigrated,
    wouldUpsert: counts.wouldUpsert,
    errors: counts.errors,
  };
}

/** Execute via migrate_dashboard_progress_block RPC (section+block+event txn). */
export async function executeGoalsMigration(
  supabase: SupabaseClient,
  batchSize?: number,
  hooks?: MigrateGoalsHooks,
): Promise<MigrateGoalsCounts> {
  return runGoalsMigration(supabase, {
    dryRun: false,
    batchSize,
    hooks,
  });
}

export async function verifyGoalsMigration(
  supabase: SupabaseClient,
): Promise<MigrateGoalsVerifyResult> {
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

  let decryptOk = 0;
  let decryptFailed = 0;
  const decryptFailedBlockIds: string[] = [];
  const chunkSize = 100;
  for (let i = 0; i < expectedIds.length; i += chunkSize) {
    const loadIds = expectedIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("dashboard_blocks")
      .select("id, payload")
      .in("id", loadIds);
    if (error) {
      throw new Error("verify: failed to load blocks for decrypt check");
    }
    const byId = new Map(
      ((data ?? []) as Array<{ id: string; payload: string }>).map((r) => [
        r.id,
        r,
      ]),
    );
    for (const id of loadIds) {
      if (!existing.has(id)) continue;
      const row = byId.get(id);
      if (!row) {
        decryptFailed += 1;
        if (decryptFailedBlockIds.length < 20) {
          decryptFailedBlockIds.push(id);
        }
        continue;
      }
      try {
        decryptBlockPayloadStrict(row);
        decryptOk += 1;
      } catch {
        decryptFailed += 1;
        if (decryptFailedBlockIds.length < 20) {
          decryptFailedBlockIds.push(id);
        }
      }
    }
  }

  return {
    goalsCount: goalsCount ?? 0,
    blocksExpected: expectedIds.length,
    missingCount: missing.length,
    missingBlockIds: missing.slice(0, 20),
    decryptOk,
    decryptFailed,
    decryptFailedBlockIds,
    ok: missing.length === 0 && decryptFailed === 0,
  };
}

/**
 * True when every goal already has a progress block (safe to hide the web UI).
 * Does not decrypt payloads.
 */
export async function isGoalsMigrationComplete(
  supabase: SupabaseClient,
): Promise<boolean> {
  const { data: goals, error } = await supabase
    .from("goals")
    .select("id")
    .order("id", { ascending: true });
  if (error) {
    throw new Error("failed to check migration completeness");
  }
  const rows = (goals ?? []) as Array<{ id: string }>;
  if (rows.length === 0) return true;
  const expectedIds = rows.map((g) => blockIdForGoal(g.id));
  const existing = await loadExistingBlockIds(supabase, expectedIds);
  return expectedIds.every((id) => existing.has(id));
}

/** In-process double-submit guard for execute (per server instance). */
let executeLock: Promise<unknown> | null = null;

export class MigrateGoalsBusyError extends Error {
  constructor() {
    super("migration already in progress");
    this.name = "MigrateGoalsBusyError";
  }
}

export async function withMigrateExecuteLock<T>(
  fn: () => Promise<T>,
): Promise<T> {
  if (executeLock) {
    throw new MigrateGoalsBusyError();
  }
  const run = fn().finally(() => {
    if (executeLock === run) executeLock = null;
  });
  executeLock = run;
  return run as Promise<T>;
}

/** Test-only: clear in-process execute lock. */
export function resetMigrateExecuteLockForTests(): void {
  executeLock = null;
}

export function auditMigrateGoalsWeb(event: {
  action: "plan" | "execute";
  credential_id: string;
  scanned?: number;
  inserted?: number;
  skippedMigrated?: number;
  conflictSkip?: number;
  wouldUpsert?: number;
  verifyOk?: boolean;
}): void {
  console.info(
    JSON.stringify({
      audit: "migrate_goals_web",
      actor_type: "user",
      action: event.action,
      credential_id: event.credential_id,
      scanned: event.scanned ?? null,
      inserted: event.inserted ?? null,
      skipped_migrated: event.skippedMigrated ?? null,
      conflict_skip: event.conflictSkip ?? null,
      would_upsert: event.wouldUpsert ?? null,
      verify_ok: event.verifyOk ?? null,
      at: new Date().toISOString(),
    }),
  );
}
