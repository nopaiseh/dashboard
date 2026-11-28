-- Travel dashboard category: reuse existing dashboard_sections / dashboard_blocks
-- + dashboard_writers + block_key upsert. No new tables or write RPCs.
--
-- IMPORTANT: Merging to main applies this on prod automatically
-- (Supabase GitHub "Deploy to production"). Keep additive / minimal.
--
-- Do NOT insert dashboard_writers rows for travel. Owner assigns writers via
-- POST /api/owner/dashboard/writers. Empty writer list → all agent writes 403.
-- Do NOT wrap in BEGIN/COMMIT (Supabase already wraps each migration).

COMMENT ON TABLE public.dashboard_writers IS
  'Owner-assigned writer agents per dashboard category (many-to-many). Empty list → all agent writes denied. cpf/bank were backfilled once when exactly one cpf section owner existed; travel has no backfill and is owner-assigned only.';

COMMENT ON COLUMN public.dashboard_blocks.block_key IS
  'Optional plaintext slot key for uniqueness / upsert. Mirrored inside encrypted payload when set. Never a personal identifier. Travel uses travel_<slot> or travel_<trip>_<slot>.';
