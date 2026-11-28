/**
 * CLI arg parsing for scripts/migrate-goals-to-blocks.ts (unit-tested).
 */

export function parseMigrateGoalsArgs(argv: string[]): {
  dryRun: boolean;
  batchSize: number;
} {
  let dryRun = true;
  let batchSize = 100;
  for (const arg of argv) {
    if (arg === "--execute") dryRun = false;
    if (arg === "--dry-run") dryRun = true;
    const batch = /^--batch-size=(\d+)$/.exec(arg);
    if (batch) {
      batchSize = Number.parseInt(batch[1], 10);
      if (!Number.isFinite(batchSize) || batchSize < 1) {
        throw new Error("--batch-size must be a positive integer");
      }
    }
  }
  return { dryRun, batchSize };
}
