-- SQL 函数冒烟：在本地 Postgres 对迁移做断言（psql -v ON_ERROR_STOP=1 -f）
-- 全部在事务中，结束时 ROLLBACK。
BEGIN;

-- 1) PATCH 冲突返回自定义 SQLSTATE XJ409
INSERT INTO public.agents (id, slug, name, area)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'test', 'Test', 'ops');

INSERT INTO public.items (
  id, kind, agent_id, project, title, body, options, due_at, source_url,
  status, content_hash
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  'todo',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '',
  't',
  'b',
  '[]'::jsonb,
  '2026-06-15T12:00:00Z',
  NULL,
  'open',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
);

DO $$
DECLARE
  v_sqlstate text;
BEGIN
  BEGIN
    PERFORM public.apply_agent_item_patch(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'approved',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      false,
      NULL,
      NULL, NULL, NULL, NULL, NULL, false, NULL, false, NULL,
      'update'
    );
    RAISE EXCEPTION 'expected conflict';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate IS DISTINCT FROM 'XJ409' THEN
        RAISE EXCEPTION 'expected XJ409, got %', v_sqlstate;
      END IF;
  END;
END;
$$;

-- 2) 同一 bootstrap 令牌两个挑战，只能 complete 成功一次
TRUNCATE public.webauthn_credentials CASCADE;
DELETE FROM public.webauthn_challenges;
UPDATE public.webauthn_registration
SET open = false, one_time_token_hash = NULL, bootstrap_consumed_at = NULL;

DO $$
DECLARE
  v_a uuid;
  v_b uuid;
  v_sqlstate text;
  v_count int;
BEGIN
  v_a := public.authorize_and_create_registration_challenge(
    'chal-a', now() + interval '10 minutes', 'tokhash', 'bootstrap'
  );
  v_b := public.authorize_and_create_registration_challenge(
    'chal-b', now() + interval '10 minutes', 'tokhash', 'bootstrap'
  );

  PERFORM public.complete_webauthn_registration(
    v_a, 'cred-1', 'pk-1', 0, '{}'::text[]
  );

  BEGIN
    PERFORM public.complete_webauthn_registration(
      v_b, 'cred-2', 'pk-2', 0, '{}'::text[]
    );
    RAISE EXCEPTION 'second complete should fail';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      -- 成功后已删其余挑战 → XJ403；若仍在则有凭据 → XJ409
      IF v_sqlstate NOT IN ('XJ403', 'XJ409') THEN
        RAISE EXCEPTION 'expected XJ403/XJ409 for second complete, got %', v_sqlstate;
      END IF;
  END;

  SELECT count(*) INTO v_count FROM public.webauthn_credentials;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 credential, got %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.webauthn_challenges
  WHERE purpose = 'register';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'expected 0 leftover register challenges, got %', v_count;
  END IF;
END;
$$;

-- 3) 登录失败原子计数：IP 5 次后锁定；credential 独立计数；global 只告警不锁
DELETE FROM public.login_attempts;
DO $$
DECLARE
  i int;
  v jsonb;
  v_cred_locked boolean;
  v_global_alert_count int := 0;
BEGIN
  -- IP 单独：前 4 次不锁
  FOR i IN 1..4 LOOP
    v := public.record_login_failure_atomic('1.2.3.4', NULL, 5, 15);
    IF (v->>'locked')::boolean THEN
      RAISE EXCEPTION 'should not lock before 5th IP failure';
    END IF;
    IF COALESCE((v->>'global_alert')::boolean, false) THEN
      v_global_alert_count := v_global_alert_count + 1;
    END IF;
  END LOOP;

  v := public.record_login_failure_atomic('1.2.3.4', NULL, 5, 15);
  IF NOT (v->>'locked')::boolean THEN
    RAISE EXCEPTION 'should lock on 5th IP failure';
  END IF;
  IF COALESCE((v->>'global_alert')::boolean, false) THEN
    v_global_alert_count := v_global_alert_count + 1;
  END IF;

  -- 第 5 次 global 应触发告警（与 IP 锁定同拍）
  IF v_global_alert_count < 1 THEN
    RAISE EXCEPTION 'expected at least one global_alert after 5 failures';
  END IF;

  -- credential 独立：另一 IP + 凭据，凭据单独锁
  DELETE FROM public.login_attempts WHERE scope IN ('ip', 'credential', 'global');
  FOR i IN 1..4 LOOP
    v := public.record_login_failure_atomic('9.9.9.9', 'cred-smoke', 5, 15);
    IF (v->>'locked')::boolean THEN
      RAISE EXCEPTION 'should not lock before 5th credential failure';
    END IF;
  END LOOP;
  v := public.record_login_failure_atomic('9.9.9.9', 'cred-smoke', 5, 15);
  IF NOT (v->>'locked')::boolean THEN
    RAISE EXCEPTION 'should lock on 5th credential/IP failure';
  END IF;

  SELECT (locked_until IS NOT NULL AND locked_until > now())
  INTO v_cred_locked
  FROM public.login_attempts
  WHERE scope = 'credential' AND scope_key = 'cred-smoke';
  IF NOT COALESCE(v_cred_locked, false) THEN
    RAISE EXCEPTION 'credential scope should be locked';
  END IF;

  -- global 永不写 locked_until
  IF EXISTS (
    SELECT 1 FROM public.login_attempts
    WHERE scope = 'global' AND locked_until IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'global scope must not set locked_until';
  END IF;
END;
$$;

ROLLBACK;

\echo OK rpc_smoke
