import { describe, expect, it } from "vitest";
import { parseMigrateGoalsArgs } from "@/lib/dashboard/migrate-goals-cli";
import {
  normalizeDueAt,
  planGoalMigration,
  planGoalMigrationIdempotent,
  type LegacyGoalRow,
} from "@/lib/dashboard/migrate-goals-plan";
import { blockIdForGoal } from "@/lib/dashboard/ids";

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
