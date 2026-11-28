-- One-time goals→blocks migration concurrency lock.
-- PostgREST/pooler cannot hold session advisory locks across RPCs, so we use a
-- lock row with TTL, serialized by pg_try_advisory_xact_lock inside acquire.
-- Merging this migration auto-applies to production (Supabase Deploy).

CREATE TABLE public.app_run_locks (
  lock_key text PRIMARY KEY,
  holder text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

ALTER TABLE public.app_run_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_run_locks FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_run_locks FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.app_run_locks TO service_role;

-- Fixed advisory lock id for migrate_goals acquire serialization (xact-scoped).
-- 872014601 = hashtext('xjg-migrate-goals-v1') on typical Postgres installs;
-- keep a literal so environments agree.

CREATE OR REPLACE FUNCTION public.try_acquire_migrate_goals_lock(
  p_holder text,
  p_ttl_seconds integer DEFAULT 900
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key constant text := 'migrate_goals';
  v_ttl integer := GREATEST(COALESCE(p_ttl_seconds, 900), 30);
BEGIN
  IF p_holder IS NULL OR length(trim(p_holder)) = 0 THEN
    RAISE EXCEPTION 'holder required'
      USING ERRCODE = 'XJ400';
  END IF;

  -- Serialize concurrent acquire attempts in this transaction.
  IF NOT pg_try_advisory_xact_lock(872014601) THEN
    RETURN false;
  END IF;

  DELETE FROM public.app_run_locks
  WHERE lock_key = v_key
    AND expires_at < now();

  BEGIN
    INSERT INTO public.app_run_locks (lock_key, holder, expires_at)
    VALUES (
      v_key,
      trim(p_holder),
      now() + make_interval(secs => v_ttl)
    );
    RETURN true;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN false;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_migrate_goals_lock(
  p_holder text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key constant text := 'migrate_goals';
  v_deleted integer;
BEGIN
  IF p_holder IS NULL OR length(trim(p_holder)) = 0 THEN
    RETURN false;
  END IF;

  DELETE FROM public.app_run_locks
  WHERE lock_key = v_key
    AND holder = trim(p_holder);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.try_acquire_migrate_goals_lock(text, integer)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_acquire_migrate_goals_lock(text, integer)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_acquire_migrate_goals_lock(text, integer)
  TO service_role;

REVOKE ALL ON FUNCTION public.release_migrate_goals_lock(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_migrate_goals_lock(text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_migrate_goals_lock(text)
  TO service_role;
