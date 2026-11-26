/**
 * One-off backfill: encrypt items.title / body / source_url with AAD, and
 * recompute content_hash as HMAC-SHA256 (CONTENT_HASH_KEY). Also rewrites
 * matching item_events.content_hash values.
 *
 * Default is --dry-run (no writes). Does NOT run against production from CI.
 *
 * Usage:
 *   npx tsx scripts/encrypt-existing-fields.ts              # dry-run
 *   npx tsx scripts/encrypt-existing-fields.ts --execute    # write
 *   npx tsx scripts/encrypt-existing-fields.ts --execute --batch-size=50
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, field encryption keyring,
 * and CONTENT_HASH_KEY. Idempotent + CAS: skips already-migrated rows; updates
 * only when columns still equal the values read (compare-and-set).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadContentHashKey, resetContentHashKeyCache } from "../src/lib/content-hash";
import {
  planItemBackfill,
  type BackfillItemRow,
} from "../src/lib/crypto/backfill-plan";
import {
  encryptField,
  resetFieldKeyringCache,
} from "../src/lib/crypto/fields-core";

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

async function casUpdateItem(
  supabase: SupabaseClient,
  row: BackfillItemRow,
  plan: Extract<ReturnType<typeof planItemBackfill>, { action: "update" }>,
): Promise<"updated" | "cas_skipped"> {
  let query = supabase
    .from("items")
    .update(plan.patch)
    .eq("id", row.id)
    .eq("title", plan.expected.title)
    .eq("body", plan.expected.body)
    .eq("content_hash", plan.expected.content_hash);

  if (plan.expected.source_url === null) {
    query = query.is("source_url", null);
  } else {
    query = query.eq("source_url", plan.expected.source_url);
  }

  const { data, error } = await query.select("id");
  if (error) {
    throw new Error(`failed CAS update item id=${row.id}`);
  }
  if (!data || data.length === 0) {
    return "cas_skipped";
  }

  // Rewrite event hashes that still carry the previous content_hash.
  const { error: eventError } = await supabase
    .from("item_events")
    .update({ content_hash: plan.patch.content_hash })
    .eq("item_id", row.id)
    .eq("content_hash", plan.previousContentHash);

  if (eventError) {
    throw new Error(`failed to rewrite item_events hashes for id=${row.id}`);
  }

  return "updated";
}

async function main(): Promise<void> {
  const { dryRun, batchSize } = parseArgs(process.argv.slice(2));
  resetFieldKeyringCache();
  resetContentHashKeyCache();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  if (!loadContentHashKey()) {
    throw new Error("CONTENT_HASH_KEY is required");
  }

  // Touch keyring early so missing keys fail before any DB work.
  encryptField("__probe__", {
    itemId: "00000000-0000-4000-8000-000000000000",
    column: "title",
  });

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let offset = 0;
  let scanned = 0;
  let wouldUpdate = 0;
  let updated = 0;
  let skippedMigrated = 0;
  let skippedCas = 0;

  console.log(
    `[encrypt-existing-fields] mode=${dryRun ? "dry-run" : "execute"} batchSize=${batchSize}`,
  );

  for (;;) {
    const { data, error } = await supabase
      .from("items")
      .select("id, title, body, source_url, kind, options, due_at, content_hash")
      .order("id", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      throw new Error(`failed to load items batch at offset ${offset}`);
    }

    const rows = (data ?? []) as BackfillItemRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const plan = planItemBackfill(row);
      if (plan.action === "skip") {
        skippedMigrated += 1;
        continue;
      }

      wouldUpdate += 1;
      if (dryRun) {
        console.log(`[dry-run] would migrate item id=${row.id}`);
        continue;
      }

      const result = await casUpdateItem(supabase, row, plan);
      if (result === "cas_skipped") {
        skippedCas += 1;
        console.log(`[execute] CAS skipped item id=${row.id} (row changed)`);
        continue;
      }
      updated += 1;
      console.log(`[execute] migrated item id=${row.id}`);
    }

    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  console.log(
    `[encrypt-existing-fields] done scanned=${scanned} skippedMigrated=${skippedMigrated} skippedCas=${skippedCas} wouldUpdate=${wouldUpdate} updated=${updated}`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "unknown error";
  console.error(`[encrypt-existing-fields] failed: ${message}`);
  process.exitCode = 1;
});
