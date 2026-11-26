/**
 * One-off backfill: encrypt legacy plaintext items.title / body / source_url.
 *
 * Default is --dry-run (no writes). Does NOT run against production from CI.
 *
 * Usage:
 *   npx tsx scripts/encrypt-existing-fields.ts              # dry-run
 *   npx tsx scripts/encrypt-existing-fields.ts --execute    # write
 *   npx tsx scripts/encrypt-existing-fields.ts --execute --batch-size=50
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and a field encryption
 * keyring (see docs/architecture.md / .env.example). Idempotent: skips rows
 * whose fields already look like ciphertext envelopes.
 */

import { createClient } from "@supabase/supabase-js";
import {
  encryptField,
  encryptNullableField,
  isEncryptedEnvelope,
  resetFieldKeyringCache,
} from "../src/lib/crypto/fields-core";

type ItemRow = {
  id: string;
  title: string;
  body: string;
  source_url: string | null;
};

function parseArgs(argv: string[]) {
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

function needsEncrypt(row: ItemRow): boolean {
  if (!isEncryptedEnvelope(row.title)) return true;
  if (!isEncryptedEnvelope(row.body)) return true;
  if (row.source_url !== null && !isEncryptedEnvelope(row.source_url)) {
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const { dryRun, batchSize } = parseArgs(process.argv.slice(2));
  resetFieldKeyringCache();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  // Touch keyring early so missing keys fail before any DB work.
  encryptField("__probe__");

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let offset = 0;
  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let skipped = 0;

  console.log(
    `[encrypt-existing-fields] mode=${dryRun ? "dry-run" : "execute"} batchSize=${batchSize}`,
  );

  for (;;) {
    const { data, error } = await supabase
      .from("items")
      .select("id, title, body, source_url")
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw new Error(`failed to load items batch at offset ${offset}`);
    }

    const rows = (data ?? []) as ItemRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      if (!needsEncrypt(row)) {
        skipped += 1;
        continue;
      }

      const patch = {
        title: isEncryptedEnvelope(row.title)
          ? row.title
          : encryptField(row.title),
        body: isEncryptedEnvelope(row.body) ? row.body : encryptField(row.body),
        source_url:
          row.source_url === null || isEncryptedEnvelope(row.source_url)
            ? row.source_url
            : encryptNullableField(row.source_url),
      };

      wouldUpdate += 1;
      if (dryRun) {
        console.log(`[dry-run] would encrypt item id=${row.id}`);
        continue;
      }

      const { error: updateError } = await supabase
        .from("items")
        .update(patch)
        .eq("id", row.id);

      if (updateError) {
        throw new Error(`failed to update item id=${row.id}`);
      }
      updated += 1;
      console.log(`[execute] encrypted item id=${row.id}`);
    }

    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  console.log(
    `[encrypt-existing-fields] done scanned=${scanned} skipped=${skipped} wouldUpdate=${wouldUpdate} updated=${updated}`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "unknown error";
  console.error(`[encrypt-existing-fields] failed: ${message}`);
  process.exitCode = 1;
});
