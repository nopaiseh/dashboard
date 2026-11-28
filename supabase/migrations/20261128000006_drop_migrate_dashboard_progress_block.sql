-- Drop unused goals→progress migration RPC from 20261128000003.
-- Application callers and the one-time migrate-goals tooling are gone (PR #21);
-- this function is no longer referenced anywhere in-repo.
-- Merging this migration auto-applies to production (Supabase Deploy).

DROP FUNCTION IF EXISTS public.migrate_dashboard_progress_block(
  uuid, text, integer, uuid, uuid, integer, uuid, text
);
