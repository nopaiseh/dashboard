import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseMigrateGoalsArgs } from "@/lib/dashboard/migrate-goals-cli";
import {
  normalizeDueAt,
  planGoalMigration,
  planGoalMigrationIdempotent,
  type LegacyGoalRow,
} from "@/lib/dashboard/migrate-goals-plan";
import { blockIdForGoal } from "@/lib/dashboard/ids";
import { encryptBlockPayload } from "@/lib/dashboard/crypto";
import { resetFieldKeyringCache } from "@/lib/crypto/fields-core";

const GOAL: LegacyGoalRow = {
  id: "33333333-3333-4333-8333-333333333333",
  area: "cpf",
  title: "OA 余额",
  target: "100k",
  metric: "SGD",
  progress: 0.55,
  due_at: "2027-01-01T00:00:00+00:00",
  agent_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  status: "active",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");

describe("migrate goals CLI", () => {
  it("defaults to dry-run", () => {
    expect(parseMigrateGoalsArgs([])).toEqual({
      dryRun: true,
      batchSize: 100,
    });
  });

  it("parses --execute and batch size", () => {
    expect(
      parseMigrateGoalsArgs(["--execute", "--batch-size=25"]),
    ).toEqual({ dryRun: false, batchSize: 25 });
  });
});

describe("migrate goals plan idempotency", () => {
  it("plans a progress block from a goal", () => {
    const plan = planGoalMigration(GOAL, new Set());
    expect(plan.action).toBe("upsert");
    if (plan.action === "upsert") {
      expect(plan.block.block_type).toBe("progress");
      expect(plan.block.id).toBe(blockIdForGoal(GOAL.id));
      expect(plan.block.payload).toEqual({
        title: "OA 余额",
        target: "100k",
        metric: "SGD",
        progress: 0.55,
        due_at: "2027-01-01T00:00:00.000Z",
        status: "active",
      });
      expect(normalizeDueAt("2027-01-01T00:00:00+00:00")).toBe(
        "2027-01-01T00:00:00.000Z",
      );
      expect(plan.section.category).toBe("cpf");
      expect(plan.section.agent_id).toBe(GOAL.agent_id);
    }
  });

  it("skips when block id already exists (idempotent)", () => {
    const first = planGoalMigration(GOAL, new Set());
    expect(first.action).toBe("upsert");
    if (first.action !== "upsert") return;

    const second = planGoalMigrationIdempotent(GOAL, first.block.id);
    expect(second).toEqual({
      action: "skip",
      reason: "already_migrated",
      blockId: first.block.id,
    });

    const third = planGoalMigration(GOAL, new Set([first.block.id]));
    expect(third.action).toBe("skip");
  });

  it("uses stable deterministic block ids across calls", () => {
    const a = planGoalMigration(GOAL, new Set());
    const b = planGoalMigration(GOAL, new Set());
    expect(a.action).toBe("upsert");
    expect(b.action).toBe("upsert");
    if (a.action === "upsert" && b.action === "upsert") {
      expect(a.block.id).toBe(b.block.id);
      expect(a.section.id).toBe(b.section.id);
    }
  });

  it("normalizes empty area to general", () => {
    const plan = planGoalMigration({ ...GOAL, area: "  " }, new Set());
    expect(plan.action).toBe("upsert");
    if (plan.action === "upsert") {
      expect(plan.section.category).toBe("general");
    }
  });
});

describe("migrate goals shared module", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FIELD_ENCRYPTION_KEY = KEY_V1;
    resetFieldKeyringCache();
  });

  function mockSupabase(opts: {
    goals: LegacyGoalRow[];
    existingBlockIds?: Set<string>;
    rpc?: (args: Record<string, unknown>) => {
      data: { status: string } | null;
      error: { code?: string } | null;
    };
  }) {
    const existing = new Set(opts.existingBlockIds ?? []);
    const rpcCalls: Record<string, unknown>[] = [];
    let writes = 0;

    const client = {
      from: (table: string) => {
        if (table === "goals") {
          return {
            select: (
              _cols: string,
              opts2?: { count?: string; head?: boolean },
            ) => {
              if (opts2?.head && opts2?.count === "exact") {
                return Promise.resolve({
                  count: opts.goals.length,
                  error: null,
                });
              }
              const result = {
                data: opts.goals.map((g) =>
                  _cols === "id" ? { id: g.id } : g,
                ),
                error: null,
              };
              const ordered = {
                range: async (from: number, to: number) => ({
                  data: opts.goals.slice(from, to + 1),
                  error: null,
                }),
                then: (
                  resolve: (v: typeof result) => void,
                  reject?: (e: unknown) => void,
                ) => Promise.resolve(result).then(resolve, reject),
              };
              return {
                order: () => ordered,
              };
            },
          };
        }
        if (table === "dashboard_blocks") {
          return {
            select: (cols: string) => ({
              in: async (_col: string, ids: string[]) => {
                if (cols === "id") {
                  return {
                    data: ids
                      .filter((id) => existing.has(id))
                      .map((id) => ({ id })),
                    error: null,
                  };
                }
                // id, payload for verify
                return {
                  data: ids
                    .filter((id) => existing.has(id))
                    .map((id) => {
                      const goal = opts.goals.find(
                        (g) => blockIdForGoal(g.id) === id,
                      );
                      const plan = goal
                        ? planGoalMigration(goal, new Set())
                        : null;
                      const payload =
                        plan && plan.action === "upsert"
                          ? encryptBlockPayload(id, plan.block.payload)
                          : "";
                      return { id, payload };
                    }),
                  error: null,
                };
              },
            }),
          };
        }
        return {};
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        expect(name).toBe("migrate_dashboard_progress_block");
        rpcCalls.push(args);
        writes += 1;
        const blockId = String(args.p_block_id);
        if (existing.has(blockId)) {
          return { data: { status: "already_migrated" }, error: null };
        }
        if (opts.rpc) {
          const result = opts.rpc(args);
          if (result.data?.status === "inserted") {
            existing.add(blockId);
          }
          return result;
        }
        existing.add(blockId);
        return { data: { status: "inserted" }, error: null };
      },
    };

    return { client, rpcCalls, getWrites: () => writes, existing };
  }

  it("dry run makes no writes", async () => {
    const { client, getWrites } = mockSupabase({ goals: [GOAL] });
    const { runGoalsMigration } = await import("@/lib/dashboard/migrate-goals");
    const counts = await runGoalsMigration(
      client as never,
      { dryRun: true },
    );
    expect(counts.scanned).toBe(1);
    expect(counts.wouldUpsert).toBe(1);
    expect(counts.inserted).toBe(0);
    expect(getWrites()).toBe(0);
  });

  it("execute is idempotent on second run", async () => {
    const { client, getWrites, existing } = mockSupabase({ goals: [GOAL] });
    const { runGoalsMigration, verifyGoalsMigration } = await import(
      "@/lib/dashboard/migrate-goals"
    );

    const first = await runGoalsMigration(client as never, { dryRun: false });
    expect(first.inserted).toBe(1);
    expect(getWrites()).toBe(1);

    const second = await runGoalsMigration(client as never, { dryRun: false });
    expect(second.skippedMigrated).toBe(1);
    expect(second.inserted).toBe(0);
    expect(getWrites()).toBe(1);

    const verify = await verifyGoalsMigration(client as never);
    expect(verify.ok).toBe(true);
    expect(verify.decryptOk).toBe(1);
    expect(verify.decryptFailedBlockIds).toEqual([]);
    expect(verify.missingBlockIds).toEqual([]);
    expect(existing.has(blockIdForGoal(GOAL.id))).toBe(true);
  });

  it("withMigrateExecuteLock uses DB lock RPCs and rejects when busy", async () => {
    let held: string | null = null;
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "try_acquire_migrate_goals_lock") {
          if (held) return { data: false, error: null };
          held = String(args.p_holder);
          return { data: true, error: null };
        }
        if (name === "release_migrate_goals_lock") {
          if (held === String(args.p_holder)) held = null;
          return { data: true, error: null };
        }
        return { data: null, error: { code: "unexpected" } };
      },
    };
    const {
      withMigrateExecuteLock,
      MigrateGoalsBusyError,
      resetMigrateExecuteLockForTests,
    } = await import("@/lib/dashboard/migrate-goals");
    resetMigrateExecuteLockForTests();

    const value = await withMigrateExecuteLock(client as never, async () => 42);
    expect(value).toBe(42);
    expect(held).toBeNull();

    held = "other";
    await expect(
      withMigrateExecuteLock(client as never, async () => 1),
    ).rejects.toBeInstanceOf(MigrateGoalsBusyError);
  });

  it("CLI script still resolves shared module exports", async () => {
    const mod = await import("@/lib/dashboard/migrate-goals");
    expect(typeof mod.runGoalsMigration).toBe("function");
    expect(typeof mod.planGoalsMigration).toBe("function");
    expect(typeof mod.executeGoalsMigration).toBe("function");
    expect(typeof mod.verifyGoalsMigration).toBe("function");
    expect(mod.MIGRATE_GOALS_WEB_ENABLED).toBe(true);
  });
});
