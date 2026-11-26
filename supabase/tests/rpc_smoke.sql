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

-- 3) 登录失败：只按 IP 锁；credential / global 只告警；换 IP 打同一凭据不锁凭据
DELETE FROM public.login_attempts;
DO $$
DECLARE
  i int;
  v jsonb;
  v_global_alert_count int := 0;
  v_cred_alert_count int := 0;
  v_cred_locked boolean;
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

  IF v_global_alert_count < 1 THEN
    RAISE EXCEPTION 'expected at least one global_alert after 5 failures';
  END IF;

  -- 换多个 IP 对同一凭据失败：不得锁凭据；locked 仅随各 IP 自身阈值
  DELETE FROM public.login_attempts WHERE scope IN ('ip', 'credential', 'global');
  FOR i IN 1..5 LOOP
    v := public.record_login_failure_atomic(
      '10.0.0.' || i::text, 'cred-smoke', 5, 15
    );
    -- 每个 IP 只失败 1 次 → 不应因凭据而 locked
    IF (v->>'locked')::boolean THEN
      RAISE EXCEPTION 'single failure per IP must not lock (got locked for %)',
        '10.0.0.' || i::text;
    END IF;
    IF COALESCE((v->>'credential_alert')::boolean, false) THEN
      v_cred_alert_count := v_cred_alert_count + 1;
    END IF;
  END LOOP;

  IF v_cred_alert_count < 1 THEN
    RAISE EXCEPTION 'expected credential_alert after 5 failures on same credential';
  END IF;

  SELECT (locked_until IS NOT NULL AND locked_until > now())
  INTO v_cred_locked
  FROM public.login_attempts
  WHERE scope = 'credential' AND scope_key = 'cred-smoke';
  IF COALESCE(v_cred_locked, false) THEN
    RAISE EXCEPTION 'credential scope must never be locked';
  END IF;

  -- credential / global 永不写 locked_until
  IF EXISTS (
    SELECT 1 FROM public.login_attempts
    WHERE scope IN ('global', 'credential') AND locked_until IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'alert-only scopes must not set locked_until';
  END IF;
END;
$$;

-- 4) 结果已读回执：仅负责姐妹可标记；open 不可标记；幂等
DO $$
DECLARE
  v_item public.items%ROWTYPE;
  v_sqlstate text;
BEGIN
  UPDATE public.items
  SET status = 'approved', result_read_at = NULL
  WHERE id = '11111111-1111-4111-8111-111111111111';

  BEGIN
    PERFORM public.mark_item_result_read(
      '11111111-1111-4111-8111-111111111111',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    );
    RAISE EXCEPTION 'expected forbidden for other agent';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate IS DISTINCT FROM 'XJ403' THEN
        RAISE EXCEPTION 'expected XJ403 for other agent, got %', v_sqlstate;
      END IF;
  END;

  v_item := public.mark_item_result_read(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );
  IF v_item.result_read_at IS NULL THEN
    RAISE EXCEPTION 'expected result_read_at after mark';
  END IF;

  v_item := public.mark_item_result_read(
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );
  IF v_item.result_read_at IS NULL THEN
    RAISE EXCEPTION 'idempotent mark should keep result_read_at';
  END IF;

  UPDATE public.items
  SET status = 'open', result_read_at = NULL
  WHERE id = '11111111-1111-4111-8111-111111111111';

  BEGIN
    PERFORM public.mark_item_result_read(
      '11111111-1111-4111-8111-111111111111',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );
    RAISE EXCEPTION 'expected conflict for open item';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate IS DISTINCT FROM 'XJ409' THEN
        RAISE EXCEPTION 'expected XJ409 for open item, got %', v_sqlstate;
      END IF;
  END;
END;
$$;

ROLLBACK;

\echo OK rpc_smoke
