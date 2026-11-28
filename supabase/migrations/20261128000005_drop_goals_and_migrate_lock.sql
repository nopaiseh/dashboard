-- Drop legacy goals table and one-time migrate-goals lock infrastructure.
-- Production goals row count is 0; owner-approved cleanup.
-- Merging this migration auto-applies to production (Supabase Deploy).
-- Explicit drops only (no CASCADE).

-- Lock RPCs from 20261128000004 (exact signatures).
DROP FUNCTION IF EXISTS public.try_acquire_migrate_goals_lock(text, integer);
DROP FUNCTION IF EXISTS public.release_migrate_goals_lock(text);

DROP TABLE IF EXISTS public.app_run_locks;

-- Goals mutation guards from 20261128000003 (triggers go with the table).
DROP TRIGGER IF EXISTS goals_no_insert ON public.goals;
DROP TRIGGER IF EXISTS goals_no_update ON public.goals;
DROP TRIGGER IF EXISTS goals_no_delete ON public.goals;
DROP TRIGGER IF EXISTS goals_no_truncate ON public.goals;
DROP TRIGGER IF EXISTS goals_set_updated_at ON public.goals;

DROP FUNCTION IF EXISTS public.forbid_goals_mutation();

DROP TABLE IF EXISTS public.goals;

DROP TYPE IF EXISTS public.goal_status;
