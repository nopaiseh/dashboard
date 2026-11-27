/**
 * One-off backfill for item field encryption / content_hash HMAC.
 *
 * Exactly one mode required:
 *   --encrypt-only   encrypt title/body/source_url with AAD (leave content_hash)
 *   --rehash-only    recompute items.content_hash as HMAC
 *                    (also attempts item_events.content_hash rewrite — 待定，
 *                     append-only 触发器可能阻止；等阁主拍板)
 *
 * Default is --dry-run (no writes). Does NOT run against production from CI.
 *
 * Usage:
 *   npx tsx scripts/encrypt-existing-fields.ts --encrypt-only
 *   npx tsx scripts/encrypt-existing-fields.ts --rehash-only
 *   npx tsx scripts/encrypt-existing-fields.ts --encrypt-only --execute
 *   # --rehash-only --execute 会被拒绝（事件表方案待定，仅允许 dry-run）
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  loadContentHashKey,
  resetContentHashKeyCache,
} from "../src/lib/content-hash";
import { parseBackfillArgs } from "../src/lib/crypto/backfill-cli";
import {
  planItemBackfill,
  type BackfillItemRow,
} from "../src/lib/crypto/backfill-plan";
import {
  encryptField,
  resetFieldKeyringCache,
} from "../src/lib/crypto/fields-core";

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

  // --rehash-only: attempt item_events rewrite (待定：表有只追加触发器，可能失败)
  if (
    plan.mode === "rehash" &&
    plan.previousContentHash &&
    plan.patch.content_hash
  ) {
    const { error: eventError } = await supabase
      .from("item_events")
      .update({ content_hash: plan.patch.content_hash })
      .eq("item_id", row.id)
      .eq("content_hash", plan.previousContentHash);

    if (eventError) {
      console.error(
        `[encrypt-existing-fields] item_events hash rewrite failed for id=${row.id} (pending owner decision on append-only trigger)`,
        { code: (eventError as { code?: string }).code ?? "unknown" },
      );
      // Do not abort items.content_hash migration; events rewrite is 待定.
    }
  }

  return "updated";
}

async function main(): Promise<void> {
  const { dryRun, batchSize, mode } = parseBackfillArgs(process.argv.slice(2));
  resetFieldKeyringCache();
  resetContentHashKeyCache();

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }

  if (mode === "rehash" && !loadContentHashKey()) {
    throw new Error("CONTENT_HASH_KEY is required for --rehash-only");
  }
  if (mode === "encrypt") {
    encryptField("__probe__", {
      itemId: "00000000-0000-4000-8000-000000000000",
      column: "title",
    });
  } else {
    // rehash still decrypts fields → need encryption keyring too
    encryptField("__probe__", {
      itemId: "00000000-0000-4000-8000-000000000000",
      column: "title",
    });
    if (!loadContentHashKey()) {
      throw new Error("CONTENT_HASH_KEY is required for --rehash-only");
    }
  }

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
    `[encrypt-existing-fields] mode=${mode} dryRun=${dryRun} batchSize=${batchSize}`,
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
      const plan = planItemBackfill(row, mode);
      if (plan.action === "skip") {
        skippedMigrated += 1;
        continue;
      }

      wouldUpdate += 1;
      if (dryRun) {
        console.log(`[dry-run] would ${mode} item id=${row.id}`);
        continue;
      }

      const result = await casUpdateItem(supabase, row, plan);
      if (result === "cas_skipped") {
        skippedCas += 1;
        console.log(`[execute] CAS skipped item id=${row.id} (row changed)`);
        continue;
      }
      updated += 1;
      console.log(`[execute] ${mode} item id=${row.id}`);
    }

    offset += rows.length;
    if (rows.length < batchSize) break;
  }

  console.log(
    `[encrypt-existing-fields] done mode=${mode} scanned=${scanned} skippedMigrated=${skippedMigrated} skippedCas=${skippedCas} wouldUpdate=${wouldUpdate} updated=${updated}`,
  );
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "unknown error";
  console.error(`[encrypt-existing-fields] failed: ${message}`);
  process.exitCode = 1;
});
