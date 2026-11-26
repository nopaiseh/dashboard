/**
 * CLI arg parsing for scripts/encrypt-existing-fields.ts (unit-tested).
 */

import type { BackfillMode } from "@/lib/crypto/backfill-plan";

export const REHASH_EXECUTE_BLOCKED_MESSAGE =
  "事件表处理方案待定，目前只允许 dry-run（--rehash-only 不可与 --execute 同用）";

export function parseBackfillArgs(argv: string[]): {
  dryRun: boolean;
  batchSize: number;
  mode: BackfillMode;
} {
  let dryRun = true;
  let batchSize = 100;
  let encryptOnly = false;
  let rehashOnly = false;
  for (const arg of argv) {
    if (arg === "--execute") dryRun = false;
    if (arg === "--dry-run") dryRun = true;
    if (arg === "--encrypt-only") encryptOnly = true;
    if (arg === "--rehash-only") rehashOnly = true;
    const batch = /^--batch-size=(\d+)$/.exec(arg);
    if (batch) {
      batchSize = Number.parseInt(batch[1], 10);
      if (!Number.isFinite(batchSize) || batchSize < 1) {
        throw new Error("--batch-size must be a positive integer");
      }
    }
  }
  if (encryptOnly === rehashOnly) {
    throw new Error("specify exactly one of --encrypt-only or --rehash-only");
  }
  const mode: BackfillMode = encryptOnly ? "encrypt" : "rehash";
  if (mode === "rehash" && !dryRun) {
    throw new Error(REHASH_EXECUTE_BLOCKED_MESSAGE);
  }
  return { dryRun, batchSize, mode };
}
