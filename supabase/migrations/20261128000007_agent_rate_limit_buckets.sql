-- Cross-instance rate limit buckets for agent bearer tokens (and reusable keys).
-- App stores key as 'agent:' || sha256(token) for valid tokens, or 'agent:invalid'
-- for unknown/revoked/invalid bearers; never the raw token.
-- Merging this migration auto-applies to production (Supabase Deploy).

CREATE TABLE public.rate_limit_buckets (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count int NOT NULL DEFAULT 0
    CHECK (request_count >= 0),
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX rate_limit_buckets_window_start_idx
  ON public.rate_limit_buckets (window_start);

ALTER TABLE public.rate_limit_buckets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rate_limit_buckets FROM PUBLIC;
REVOKE ALL ON TABLE public.rate_limit_buckets FROM anon, authenticated;
-- No table grants: access only via SECURITY DEFINER RPC below.

CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_key text,
  p_limit int,
  p_window_seconds int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start timestamptz;
  v_count int;
  v_allowed boolean;
  v_remaining int;
  v_retry int;
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RAISE EXCEPTION 'key required'
      USING ERRCODE = 'XJ400';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'limit must be >= 1'
      USING ERRCODE = 'XJ400';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'window_seconds must be >= 1'
      USING ERRCODE = 'XJ400';
  END IF;

  -- ~1% of calls: bounded cleanup of stale windows (older than 1 day, max 500).
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limit_buckets
    WHERE ctid IN (
      SELECT ctid
      FROM public.rate_limit_buckets
      WHERE window_start < (now() - interval '1 day')
      LIMIT 500
    );
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.rate_limit_buckets (bucket_key, window_start, request_count)
  VALUES (trim(p_key), v_window_start, 1)
  ON CONFLICT (bucket_key, window_start) DO UPDATE
  SET request_count = public.rate_limit_buckets.request_count + 1
  RETURNING request_count INTO v_count;

  v_allowed := v_count <= p_limit;
  v_remaining := GREATEST(0, p_limit - v_count);
  v_retry := GREATEST(
    1,
    CEIL(
      EXTRACT(
        EPOCH FROM (
          v_window_start + make_interval(secs => p_window_seconds) - now()
        )
      )
    )::int
  );

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'remaining', v_remaining,
    'retry_after_seconds', v_retry
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rate_limit_check(text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rate_limit_check(text, int, int)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_check(text, int, int)
  TO service_role;
