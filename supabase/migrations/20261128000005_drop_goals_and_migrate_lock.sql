-- Drop legacy goals table and one-time migrate-goals lock infrastructure.
-- Production goals row count is 0; owner-approved cleanup.
-- Merging this migration auto-applies to production (Supabase Deploy).
-- Explicit drops only (no CASCADE).

-- 1) Lock RPCs + table from 20261128000004 (functions first, then table).
DROP FUNCTION IF EXISTS public.try_acquire_migrate_goals_lock(text, integer);
DROP FUNCTION IF EXISTS public.release_migrate_goals_lock(text);
DROP TABLE IF EXISTS public.app_run_locks;

-- 2) Refuse to drop goals if any rows remain (never silently delete data).
DO $$
DECLARE
  v_has_rows boolean := false;
BEGIN
  IF to_regclass('public.goals') IS NULL THEN
    RETURN;
  END IF;
  -- Dynamic SQL so planning does not fail when the table is already gone.
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.goals LIMIT 1)' INTO v_has_rows;
  IF v_has_rows THEN
    RAISE EXCEPTION
      'refusing to drop public.goals: table still has rows (migrate or delete first)';
  END IF;
END $$;

-- 3) Goals mutation guards from 20261128000003 (triggers go with the table).
DROP TRIGGER IF EXISTS goals_no_insert ON public.goals;
DROP TRIGGER IF EXISTS goals_no_update ON public.goals;
DROP TRIGGER IF EXISTS goals_no_delete ON public.goals;
DROP TRIGGER IF EXISTS goals_no_truncate ON public.goals;
DROP TRIGGER IF EXISTS goals_set_updated_at ON public.goals;

DROP FUNCTION IF EXISTS public.forbid_goals_mutation();

DROP TABLE IF EXISTS public.goals;

DROP TYPE IF EXISTS public.goal_status;
