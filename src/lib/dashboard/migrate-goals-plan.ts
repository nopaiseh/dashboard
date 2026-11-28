/**
 * Pure planning for goals → dashboard progress blocks (unit-tested).
 * Encryption happens in the script after planning — this module never encrypts.
 */

import { blockIdForGoal, sectionIdForCategory } from "@/lib/dashboard/ids";
import type { ProgressPayload } from "@/lib/dashboard/types";

export interface LegacyGoalRow {
  id: string;
  area: string;
  title: string;
  target: string;
  metric: string;
  progress: number | string;
  due_at: string | null;
  agent_id: string | null;
  status: string;
  updated_at: string;
}

export type SectionUpsert = {
  /** Preferred deterministic id when inserting a new section. */
  id: string;
  category: string;
  sort_order: number;
  agent_id: string | null;
};

export type BlockUpsert = {
  id: string;
  /** Filled with preferred section id; script may rewrite if section already exists. */
  section_id: string;
  block_type: "progress";
  sort_order: number;
  agent_id: string | null;
  /** Plaintext progress payload — encrypt before insert. */
  payload: ProgressPayload;
};

export type GoalMigrationPlan =
  | { action: "skip"; reason: "already_migrated"; blockId: string }
  | {
      action: "upsert";
      section: SectionUpsert;
      block: BlockUpsert;
      goalId: string;
    };

export function normalizeGoalCategory(area: string): string {
  const trimmed = area.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 64) : "general";
}

function toProgressNumber(value: number | string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize timestamptz strings to `.000Z` so zod datetime() accepts PATCH round-trips. */
export function normalizeDueAt(dueAt: string | null): string | null {
  if (dueAt === null || dueAt === undefined) return null;
  const ms = Date.parse(dueAt);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function planGoalMigration(
  goal: LegacyGoalRow,
  existingBlockIds: ReadonlySet<string>,
): GoalMigrationPlan {
  const blockId = blockIdForGoal(goal.id);
  if (existingBlockIds.has(blockId)) {
    return { action: "skip", reason: "already_migrated", blockId };
  }

  const category = normalizeGoalCategory(goal.area);
  const sectionId = sectionIdForCategory(category, goal.agent_id);

  return {
    action: "upsert",
    goalId: goal.id,
    section: {
      id: sectionId,
      category,
      sort_order: 0,
      agent_id: goal.agent_id,
    },
    block: {
      id: blockId,
      section_id: sectionId,
      block_type: "progress",
      sort_order: 0,
      agent_id: goal.agent_id,
      payload: {
        title: goal.title,
        target: goal.target,
        metric: goal.metric,
        progress: toProgressNumber(goal.progress),
        due_at: normalizeDueAt(goal.due_at),
        status: goal.status,
      },
    },
  };
}

/** Re-run over the same goal + already-known block id → skip (idempotent). */
export function planGoalMigrationIdempotent(
  goal: LegacyGoalRow,
  previouslyPlannedBlockId: string,
): GoalMigrationPlan {
  return planGoalMigration(goal, new Set([previouslyPlannedBlockId]));
}
