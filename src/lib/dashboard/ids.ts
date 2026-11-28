/**
 * Deterministic UUIDv5 helpers for idempotent goals → blocks migration.
 * Namespace is fixed for this migration only.
 */

import { createHash } from "node:crypto";

/** Fixed 16-byte namespace: xjg-dashboard-goals-migrate-v1 */
const GOALS_MIGRATE_NS = Buffer.from("a7c31e5f0b924d6e8f1a2c3d4e5f6071", "hex");

function uuidV5(name: string, namespace: Buffer = GOALS_MIGRATE_NS): string {
  const hash = createHash("sha1").update(namespace).update(name, "utf8").digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Section id derived from category + owning agent (null → "null"). */
export function sectionIdForCategory(
  category: string,
  agentId: string | null,
): string {
  return uuidV5(`section:${category}:${agentId ?? "null"}`);
}

/** Block id derived from legacy goals.id — stable across re-runs. */
export function blockIdForGoal(goalId: string): string {
  return uuidV5(`goal:${goalId}`);
}
