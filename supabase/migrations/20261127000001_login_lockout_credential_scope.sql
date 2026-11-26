-- 登录锁定策略：只按 IP 锁定；credential 与 global 只计数告警、不锁人。
-- （options 未登录可拿到凭据 ID，按凭据锁会被换 IP 把主人锁在门外。）
-- 原子 upsert 计数沿用 _bump_login_failure；告警计数用 _bump_login_alert_count。

ALTER TABLE public.login_attempts
  DROP CONSTRAINT IF EXISTS login_attempts_scope_check;

ALTER TABLE public.login_attempts
  ADD CONSTRAINT login_attempts_scope_check CHECK (
    scope IN ('ip', 'global', 'credential', 'auth_options', 'register_options')
  );

-- 清除历史全站 / 凭据锁定（新策略不再锁这些 scope）
UPDATE public.login_attempts
SET locked_until = NULL
WHERE scope IN ('global', 'credential') AND locked_until IS NOT NULL;

-- 告警专用：只递增计数，达阈值后标记告警并归零；永不写 locked_until
CREATE OR REPLACE FUNCTION public._bump_login_alert_count(
  p_scope text,
  p_scope_key text,
  p_max_failures int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.login_attempts%ROWTYPE;
  v_next int;
BEGIN
  INSERT INTO public.login_attempts (scope, scope_key, failed_count, locked_until, updated_at)
  VALUES (p_scope, p_scope_key, 0, NULL, now())
  ON CONFLICT (scope, scope_key) DO NOTHING;

  SELECT * INTO v_row
  FROM public.login_attempts
  WHERE scope = p_scope AND scope_key = p_scope_key
  FOR UPDATE;

  IF v_row.failed_count > 0 THEN
    v_next := v_row.failed_count + 1;
  ELSE
    v_next := 1;
  END IF;

  IF v_next >= p_max_failures THEN
    UPDATE public.login_attempts
    SET failed_count = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE id = v_row.id;
    RETURN jsonb_build_object(
      'count', v_next,
      'alert', true
    );
  END IF;

  UPDATE public.login_attempts
  SET failed_count = v_next,
      locked_until = NULL,
      updated_at = now()
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'count', v_next,
    'alert', false
  );
END;
$$;

-- 兼容旧名（若曾部署过本 PR 迁移的草稿）；统一走 _bump_login_alert_count
CREATE OR REPLACE FUNCTION public._bump_login_global_alert(
  p_max_failures int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._bump_login_alert_count('global', 'all', p_max_failures);
END;
$$;

-- 替换签名：增加可选 credential id；仅 IP 可导致 locked
DROP FUNCTION IF EXISTS public.record_login_failure_atomic(text, int, int);

CREATE OR REPLACE FUNCTION public.record_login_failure_atomic(
  p_ip text,
  p_credential_id text DEFAULT NULL,
  p_max_failures int DEFAULT 5,
  p_lock_minutes int DEFAULT 15
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ip_locked boolean;
  v_cred jsonb := jsonb_build_object('count', 0, 'alert', false);
  v_global jsonb;
BEGIN
  v_ip_locked := public._bump_login_failure(
    'ip', p_ip, p_max_failures, p_lock_minutes
  );

  IF p_credential_id IS NOT NULL AND length(trim(p_credential_id)) > 0 THEN
    v_cred := public._bump_login_alert_count(
      'credential', trim(p_credential_id), p_max_failures
    );
  END IF;

  v_global := public._bump_login_alert_count('global', 'all', p_max_failures);

  RETURN jsonb_build_object(
    'locked', v_ip_locked,
    'global_count', COALESCE((v_global->>'count')::int, 0),
    'global_alert', COALESCE((v_global->>'alert')::boolean, false),
    'credential_count', COALESCE((v_cred->>'count')::int, 0),
    'credential_alert', COALESCE((v_cred->>'alert')::boolean, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._bump_login_alert_count(text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._bump_login_alert_count(text, text, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bump_login_alert_count(text, text, int) TO service_role;

REVOKE ALL ON FUNCTION public._bump_login_global_alert(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._bump_login_global_alert(int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bump_login_global_alert(int) TO service_role;

REVOKE ALL ON FUNCTION public.record_login_failure_atomic(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_login_failure_atomic(text, text, int, int) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_failure_atomic(text, text, int, int) TO service_role;
