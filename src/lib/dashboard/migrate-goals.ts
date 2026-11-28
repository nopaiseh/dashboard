/**
 * Shared goals → dashboard_blocks migration core (CLI + one-time web UI).
 * Never logs plaintext payloads or encryption secrets — only counts, ids, error codes.
 */

import { randomUUID } from "node:crypto";
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

/** Per-item failure: ids + error code only (never messages / stacks / plaintext). */
export type MigrateGoalsFailure = {
  goalId?: string;
  blockId?: string;
  code: string;
};

export type MigrateGoalsCounts = {
  scanned: number;
  skippedMigrated: number;
  wouldUpsert: number;
  inserted: number;
  conflictSkip: number;
  errors: number;
  failures: MigrateGoalsFailure[];
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
  /** First missing block ids (capped) for CLI / UI — never payloads. */
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
const VERIFY_PAGE = 500;
const FAILURE_IDS_CAP = 50;

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

/** Paginate goals.id so PostgREST's ~1000-row default cannot truncate. */
export async function loadAllGoalIds(
  supabase: SupabaseClient,
): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("goals")
      .select("id")
      .order("id", { ascending: true })
      .range(offset, offset + VERIFY_PAGE - 1);
    if (error) {
      throw new Error("failed to load goal ids");
    }
    const rows = (data ?? []) as Array<{ id: string }>;
    if (rows.length === 0) break;
    for (const row of rows) ids.push(row.id);
    offset += rows.length;
    if (rows.length < VERIFY_PAGE) break;
  }
  return ids;
}

async function migrateOne(
  supabase: SupabaseClient,
  plan: Extract<ReturnType<typeof planGoalMigration>, { action: "upsert" }>,
): Promise<
  | { ok: true; result: "inserted" | "already_migrated" }
  | { ok: false; code: string }
> {
  try {
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
      return {
        ok: false,
        code: (error as { code?: string }).code ?? "rpc_error",
      };
    }

    const status = (data as { status?: string } | null)?.status;
    if (status === "already_migrated") {
      return { ok: true, result: "already_migrated" };
    }
    if (status === "inserted") {
      return { ok: true, result: "inserted" };
    }
    return { ok: false, code: "unexpected_status" };
  } catch {
    return { ok: false, code: "migrate_exception" };
  }
}

/**
 * Plan (dry-run) or execute migration. Idempotent block ids (UUIDv5).
 * Dry-run performs no writes. Execute catches per-item errors and continues.
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
    failures: [],
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

      const migrated = await migrateOne(supabase, plan);
      if (!migrated.ok) {
        counts.errors += 1;
        const failure: MigrateGoalsFailure = {
          goalId: goal.id,
          blockId: plan.block.id,
          code: migrated.code,
        };
        if (counts.failures.length < FAILURE_IDS_CAP) {
          counts.failures.push(failure);
        }
        hooks?.onError?.(failure);
        continue;
      }

      if (migrated.result === "already_migrated") {
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

  const goalIds = await loadAllGoalIds(supabase);
  const expectedIds = goalIds.map((id) => blockIdForGoal(id));
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
 * Does not decrypt payloads. Paginates goal ids.
 */
export async function isGoalsMigrationComplete(
  supabase: SupabaseClient,
): Promise<boolean> {
  const goalIds = await loadAllGoalIds(supabase);
  if (goalIds.length === 0) return true;
  const expectedIds = goalIds.map((id) => blockIdForGoal(id));
  const existing = await loadExistingBlockIds(supabase, expectedIds);
  return expectedIds.every((id) => existing.has(id));
}

/** In-process double-submit guard (per server instance); DB lock is authoritative. */
let executeLock: Promise<unknown> | null = null;

export class MigrateGoalsBusyError extends Error {
  constructor() {
    super("migration already in progress");
    this.name = "MigrateGoalsBusyError";
  }
}

export async function acquireMigrateGoalsDbLock(
  supabase: SupabaseClient,
  holder: string,
  ttlSeconds = 900,
): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "try_acquire_migrate_goals_lock",
    {
      p_holder: holder,
      p_ttl_seconds: ttlSeconds,
    },
  );
  if (error) {
    throw new Error("failed to acquire migrate_goals lock");
  }
  return data === true;
}

export async function releaseMigrateGoalsDbLock(
  supabase: SupabaseClient,
  holder: string,
): Promise<void> {
  const { error } = await supabase.rpc("release_migrate_goals_lock", {
    p_holder: holder,
  });
  if (error) {
    // Best-effort release; TTL expires the row if this fails.
  }
}

/**
 * One run at a time: in-process guard + Postgres lock row
 * (try_acquire_migrate_goals_lock uses pg_try_advisory_xact_lock).
 */
export async function withMigrateExecuteLock<T>(
  supabase: SupabaseClient,
  fn: () => Promise<T>,
): Promise<T> {
  if (executeLock) {
    throw new MigrateGoalsBusyError();
  }

  const holder = randomUUID();
  const acquired = await acquireMigrateGoalsDbLock(supabase, holder);
  if (!acquired) {
    throw new MigrateGoalsBusyError();
  }

  const run = (async () => {
    try {
      return await fn();
    } finally {
      await releaseMigrateGoalsDbLock(supabase, holder);
    }
  })().finally(() => {
    if (executeLock === run) executeLock = null;
  });
  executeLock = run;
  return run as Promise<T>;
}

/** Test-only: clear in-process execute lock. */
export function resetMigrateExecuteLockForTests(): void {
  executeLock = null;
}

export type MigrateGoalsAuditEvent = {
  action:
    | "plan"
    | "execute"
    | "step_up_failed"
    | "busy"
    | "plan_error"
    | "execute_error";
  credential_id?: string | null;
  scanned?: number;
  inserted?: number;
  skippedMigrated?: number;
  conflictSkip?: number;
  wouldUpsert?: number;
  errors?: number;
  verifyOk?: boolean;
  /** Error / step-up failure code only. */
  error_code?: string;
  /** Failed item ids + codes (capped); never plaintext. */
  failures?: Array<{
    goal_id?: string;
    block_id?: string;
    code: string;
  }>;
};

export function auditMigrateGoalsWeb(event: MigrateGoalsAuditEvent): void {
  console.info(
    JSON.stringify({
      audit: "migrate_goals_web",
      actor_type: "user",
      action: event.action,
      credential_id: event.credential_id ?? null,
      scanned: event.scanned ?? null,
      inserted: event.inserted ?? null,
      skipped_migrated: event.skippedMigrated ?? null,
      conflict_skip: event.conflictSkip ?? null,
      would_upsert: event.wouldUpsert ?? null,
      errors: event.errors ?? null,
      verify_ok: event.verifyOk ?? null,
      error_code: event.error_code ?? null,
      failures: event.failures ?? null,
      at: new Date().toISOString(),
    }),
  );
}
