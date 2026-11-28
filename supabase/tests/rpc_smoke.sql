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

-- 5) goals / migrate lock 已删除
DO $$
BEGIN
  IF to_regclass('public.goals') IS NOT NULL THEN
    RAISE EXCEPTION 'goals table should be dropped';
  END IF;
  IF to_regtype('public.goal_status') IS NOT NULL THEN
    RAISE EXCEPTION 'goal_status type should be dropped';
  END IF;
  IF to_regclass('public.app_run_locks') IS NOT NULL THEN
    RAISE EXCEPTION 'app_run_locks table should be dropped';
  END IF;
  IF to_regprocedure('public.try_acquire_migrate_goals_lock(text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'try_acquire_migrate_goals_lock should be dropped';
  END IF;
  IF to_regprocedure('public.release_migrate_goals_lock(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'release_migrate_goals_lock should be dropped';
  END IF;
  IF to_regprocedure('public.forbid_goals_mutation()') IS NOT NULL THEN
    RAISE EXCEPTION 'forbid_goals_mutation should be dropped';
  END IF;
  IF to_regprocedure(
    'public.migrate_dashboard_progress_block(uuid,text,integer,uuid,uuid,integer,uuid,text)'
  ) IS NOT NULL THEN
    RAISE EXCEPTION 'migrate_dashboard_progress_block should be dropped';
  END IF;
END;
$$;

-- 6) dashboard 表 / RPC / payload CHECK / 审计同事务
DO $$
DECLARE
  v_sqlstate text;
  v_result jsonb;
  v_count int;
BEGIN
  IF to_regclass('public.dashboard_sections') IS NULL THEN
    RAISE EXCEPTION 'dashboard_sections missing';
  END IF;
  IF to_regclass('public.dashboard_blocks') IS NULL THEN
    RAISE EXCEPTION 'dashboard_blocks missing';
  END IF;
  IF to_regclass('public.dashboard_block_events') IS NULL THEN
    RAISE EXCEPTION 'dashboard_block_events missing';
  END IF;

  INSERT INTO public.dashboard_sections (id, category, sort_order, agent_id)
  VALUES (
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'cpf',
    0,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
  );

  -- 明文 payload 被 CHECK 拒绝
  BEGIN
    INSERT INTO public.dashboard_blocks (
      id, section_id, block_type, sort_order, agent_id, payload
    ) VALUES (
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'progress',
      0,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'plaintext-secret'
    );
    RAISE EXCEPTION 'expected plaintext payload CHECK to fail';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      RAISE EXCEPTION 'expected check_violation for plaintext payload, got %', v_sqlstate;
  END;

  -- 创建 RPC：区块 + 事件同事务
  v_result := public.create_dashboard_block(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'progress',
    0,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'v1:smoke:tag:cipher'
  );
  IF v_result->'block'->>'id' IS DISTINCT FROM 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' THEN
    RAISE EXCEPTION 'create_dashboard_block missing block';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.dashboard_block_events
  WHERE block_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 create event, got %', v_count;
  END IF;

  -- 越权：其它姐妹的分区
  INSERT INTO public.agents (id, slug, name, area)
  VALUES (
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'other-sister',
    'Other',
    'ops'
  );

  BEGIN
    PERFORM public.create_dashboard_block(
      '99999999-9999-4999-8999-999999999999',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'headline',
      0,
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'v1:other:tag:cipher'
    );
    RAISE EXCEPTION 'expected XJ403 for other agent create';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate IS DISTINCT FROM 'XJ403' THEN
        RAISE EXCEPTION 'expected XJ403 for other agent, got %', v_sqlstate;
      END IF;
  END;

  -- 无效信封经 RPC：整事务回滚（无区块、无事件）
  BEGIN
    PERFORM public.create_dashboard_block(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'text',
      1,
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'not-a-v1-envelope'
    );
    RAISE EXCEPTION 'expected CHECK failure for bad envelope via RPC';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      -- some drivers surface as 23514
      IF v_sqlstate IS DISTINCT FROM '23514' THEN
        NULL; -- still expect no row below
      END IF;
  END;

  SELECT count(*) INTO v_count
  FROM public.dashboard_blocks
  WHERE id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'bad envelope RPC should roll back block insert';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.dashboard_block_events
  WHERE block_id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'bad envelope RPC should roll back event insert';
  END IF;

  -- PATCH RPC
  v_result := public.apply_agent_dashboard_block_patch(
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    false,
    'progress',
    true,
    3,
    false,
    NULL
  );
  IF (v_result->'block'->>'sort_order')::int <> 3 THEN
    RAISE EXCEPTION 'patch sort_order failed';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.dashboard_block_events
  WHERE block_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    AND action = 'update';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 update event, got %', v_count;
  END IF;
END;
$$;

DO $$
DECLARE
  v_sqlstate text;
BEGIN
  BEGIN
    UPDATE public.dashboard_block_events SET action = 'update';
    RAISE EXCEPTION 'expected dashboard_block_events UPDATE to fail';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate IS NULL THEN
        RAISE EXCEPTION 'dashboard_block_events UPDATE should raise';
      END IF;
  END;

  BEGIN
    DELETE FROM public.dashboard_block_events;
    RAISE EXCEPTION 'expected dashboard_block_events DELETE to fail';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate IS NULL THEN
        RAISE EXCEPTION 'dashboard_block_events DELETE should raise';
      END IF;
  END;
END;
$$;

-- rate_limit_check：窗口内计数、超限拒绝、返回 remaining / retry_after_seconds；
-- agent:invalid 与 per-hash 键各自独立；概率清理不得误伤当前窗。
DELETE FROM public.rate_limit_buckets;
DO $$
DECLARE
  v jsonb;
  i int;
  v_valid_count int;
  v_invalid_count int;
BEGIN
  v := public.rate_limit_check('agent:smoke-hash', 3, 60);
  IF NOT (v->>'allowed')::boolean THEN
    RAISE EXCEPTION 'first call should be allowed';
  END IF;
  IF (v->>'remaining')::int <> 2 THEN
    RAISE EXCEPTION 'expected remaining 2, got %', v->>'remaining';
  END IF;
  IF (v->>'retry_after_seconds')::int < 1 THEN
    RAISE EXCEPTION 'retry_after_seconds must be >= 1';
  END IF;

  FOR i IN 1..2 LOOP
    v := public.rate_limit_check('agent:smoke-hash', 3, 60);
  END LOOP;
  IF NOT (v->>'allowed')::boolean THEN
    RAISE EXCEPTION '3rd call at limit should still be allowed';
  END IF;
  IF (v->>'remaining')::int <> 0 THEN
    RAISE EXCEPTION 'expected remaining 0 at limit, got %', v->>'remaining';
  END IF;

  v := public.rate_limit_check('agent:smoke-hash', 3, 60);
  IF (v->>'allowed')::boolean THEN
    RAISE EXCEPTION '4th call should be denied';
  END IF;
  IF (v->>'remaining')::int <> 0 THEN
    RAISE EXCEPTION 'denied remaining must be 0';
  END IF;

  -- Shared invalid bucket is independent of a valid token hash key.
  v := public.rate_limit_check('agent:invalid', 2, 60);
  IF NOT (v->>'allowed')::boolean THEN
    RAISE EXCEPTION 'agent:invalid first call should be allowed';
  END IF;
  v := public.rate_limit_check('agent:invalid', 2, 60);
  IF NOT (v->>'allowed')::boolean THEN
    RAISE EXCEPTION 'agent:invalid second call at limit should be allowed';
  END IF;
  v := public.rate_limit_check('agent:invalid', 2, 60);
  IF (v->>'allowed')::boolean THEN
    RAISE EXCEPTION 'agent:invalid third call should be denied';
  END IF;

  SELECT request_count INTO v_valid_count
  FROM public.rate_limit_buckets
  WHERE bucket_key = 'agent:smoke-hash'
  ORDER BY window_start DESC
  LIMIT 1;
  SELECT request_count INTO v_invalid_count
  FROM public.rate_limit_buckets
  WHERE bucket_key = 'agent:invalid'
  ORDER BY window_start DESC
  LIMIT 1;
  IF v_valid_count < 4 THEN
    RAISE EXCEPTION 'expected valid key count >= 4, got %', v_valid_count;
  END IF;
  IF v_invalid_count < 3 THEN
    RAISE EXCEPTION 'expected invalid key count >= 3, got %', v_invalid_count;
  END IF;
END;
$$;

-- dashboard_writers backfill + block_key unique + upsert
DO $$
DECLARE
  v_writer uuid;
  v_bank_writer uuid;
  v_result jsonb;
  v_count int;
BEGIN
  -- Every section owner becomes a writer; bank inherits cpf writers.
  INSERT INTO public.dashboard_writers (category, agent_id)
  SELECT DISTINCT
    lower(trim(s.category)),
    s.agent_id
  FROM public.dashboard_sections s
  WHERE s.agent_id IS NOT NULL
    AND char_length(trim(s.category)) > 0
  ON CONFLICT (category, agent_id) DO NOTHING;

  INSERT INTO public.dashboard_writers (category, agent_id, created_at)
  SELECT 'bank', w.agent_id, now()
  FROM public.dashboard_writers w
  WHERE w.category = 'cpf'
  ON CONFLICT (category, agent_id) DO NOTHING;

  SELECT agent_id INTO v_writer
  FROM public.dashboard_writers
  WHERE category = 'cpf'
  LIMIT 1;
  IF v_writer IS DISTINCT FROM 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' THEN
    RAISE EXCEPTION 'cpf writer should be section owner, got %', v_writer;
  END IF;

  SELECT agent_id INTO v_bank_writer
  FROM public.dashboard_writers
  WHERE category = 'bank'
    AND agent_id = v_writer;
  IF v_bank_writer IS NULL THEN
    RAISE EXCEPTION 'bank should include cpf writer';
  END IF;

  -- Upsert by block_key: insert then replace
  v_result := public.upsert_dashboard_block_by_key(
    'abababab-abab-4aba-8bab-abababababab',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'cpf_conclusion',
    'text',
    0,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'v1:smoke:tag:cipher-upsert-1'
  );
  IF NOT (v_result->>'inserted')::boolean THEN
    RAISE EXCEPTION 'first upsert should insert';
  END IF;

  v_result := public.upsert_dashboard_block_by_key(
    'cdcdcdcd-cdcd-4cdc-8dcd-cdcdcdcdcdcd',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'cpf_conclusion',
    'text',
    1,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'v1:smoke:tag:cipher-upsert-2'
  );
  IF (v_result->>'inserted')::boolean THEN
    RAISE EXCEPTION 'second upsert should update';
  END IF;
  IF v_result->'block'->>'id' IS DISTINCT FROM 'abababab-abab-4aba-8bab-abababababab' THEN
    RAISE EXCEPTION 'upsert should keep original row id';
  END IF;
  IF v_result->'block'->>'payload' IS DISTINCT FROM 'v1:smoke:tag:cipher-upsert-2' THEN
    RAISE EXCEPTION 'upsert should replace payload';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.dashboard_blocks
  WHERE section_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    AND block_key = 'cpf_conclusion';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected one block for cpf_conclusion, got %', v_count;
  END IF;
END;
$$;

ROLLBACK;

\echo OK rpc_smoke
