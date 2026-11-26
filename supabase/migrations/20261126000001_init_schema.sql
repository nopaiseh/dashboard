-- 玄机阁：核心 schema（2026）
-- 全部表启用 RLS，且不授予 anon/authenticated 任何策略；仅 service_role 访问。
-- 所有函数 SET search_path = public, pg_temp，并用全限定名。

CREATE TYPE public.item_kind AS ENUM (
  'approval',
  'todo',
  'question_to_user',
  'question_from_user',
  'waiting'
);

CREATE TYPE public.item_status AS ENUM (
  'open',
  'approved',
  'rejected',
  'replied',
  'done',
  'withdrawn'
);

CREATE TYPE public.actor_type AS ENUM ('user', 'agent');

CREATE TYPE public.item_action AS ENUM (
  'create',
  'update',
  'approve',
  'reject',
  'reply',
  'comment',
  'withdraw'
);

CREATE TYPE public.goal_status AS ENUM (
  'active',
  'paused',
  'done',
  'cancelled'
);

CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  area text NOT NULL DEFAULT '',
  bot_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.agents (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX agent_tokens_agent_id_idx ON public.agent_tokens (agent_id);
CREATE INDEX agent_tokens_active_hash_idx
  ON public.agent_tokens (token_hash)
  WHERE revoked_at IS NULL;

CREATE TABLE public.items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.item_kind NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.agents (id),
  project text NOT NULL DEFAULT '',
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_at timestamptz,
  source_url text,
  status public.item_status NOT NULL DEFAULT 'open',
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX items_agent_id_idx ON public.items (agent_id);
CREATE INDEX items_status_idx ON public.items (status);
CREATE INDEX items_kind_idx ON public.items (kind);
CREATE INDEX items_last_activity_at_idx ON public.items (last_activity_at);

CREATE TABLE public.item_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items (id) ON DELETE CASCADE,
  actor_type public.actor_type NOT NULL,
  agent_id uuid REFERENCES public.agents (id),
  action public.item_action NOT NULL,
  option_key text,
  reply_text text,
  credential_id text,
  verified_at timestamptz,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX item_events_item_id_idx ON public.item_events (item_id);
CREATE INDEX item_events_created_at_idx ON public.item_events (created_at);

CREATE OR REPLACE FUNCTION public.forbid_item_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'item_events is append-only: % not allowed', TG_OP;
END;
$$;

CREATE TRIGGER item_events_no_update
  BEFORE UPDATE ON public.item_events
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_item_events_mutation();

CREATE TRIGGER item_events_no_delete
  BEFORE DELETE ON public.item_events
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_item_events_mutation();

CREATE TRIGGER item_events_no_truncate
  BEFORE TRUNCATE ON public.item_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.forbid_item_events_mutation();

CREATE TABLE public.goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL DEFAULT '',
  title text NOT NULL,
  target text NOT NULL DEFAULT '',
  metric text NOT NULL DEFAULT '',
  progress numeric NOT NULL DEFAULT 0,
  due_at timestamptz,
  agent_id uuid REFERENCES public.agents (id),
  status public.goal_status NOT NULL DEFAULT 'active',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX goals_area_idx ON public.goals (area);
CREATE INDEX goals_status_idx ON public.goals (status);

CREATE TABLE public.daily_summaries (
  date date PRIMARY KEY,
  content text NOT NULL,
  generated_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 注册默认关闭；首次也须一次性令牌（BOOTSTRAP_TOKEN 或新设备令牌）
CREATE TABLE public.webauthn_registration (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  open boolean NOT NULL DEFAULT false,
  one_time_token_hash text,
  one_time_token_expires_at timestamptz,
  bootstrap_consumed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.webauthn_registration (id, open)
VALUES (1, false);

CREATE TABLE public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (
    scope IN ('ip', 'global', 'auth_options', 'register_options')
  ),
  scope_key text NOT NULL,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_key)
);

CREATE INDEX login_attempts_locked_until_idx
  ON public.login_attempts (locked_until)
  WHERE locked_until IS NOT NULL;

CREATE TABLE public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('login', 'register', 'step_up')),
  item_id uuid REFERENCES public.items (id) ON DELETE CASCADE,
  authorized boolean NOT NULL DEFAULT false,
  -- 注册挑战：bootstrap（首次）或 invite（新设备）；其它 purpose 为 NULL
  registration_mode text CHECK (
    registration_mode IS NULL
    OR registration_mode IN ('bootstrap', 'invite')
  ),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webauthn_challenges_expires_at_idx
  ON public.webauthn_challenges (expires_at);

CREATE OR REPLACE VIEW public.stale_items
WITH (security_invoker = true)
AS
SELECT *
FROM public.items
WHERE status = 'open'
  AND last_activity_at < (now() - interval '7 days');

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_registration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webauthn_challenges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agents FROM anon, authenticated;
REVOKE ALL ON TABLE public.agent_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.items FROM anon, authenticated;
REVOKE ALL ON TABLE public.item_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.goals FROM anon, authenticated;
REVOKE ALL ON TABLE public.daily_summaries FROM anon, authenticated;
REVOKE ALL ON TABLE public.webauthn_credentials FROM anon, authenticated;
REVOKE ALL ON TABLE public.webauthn_registration FROM anon, authenticated;
REVOKE ALL ON TABLE public.login_attempts FROM anon, authenticated;
REVOKE ALL ON TABLE public.webauthn_challenges FROM anon, authenticated;
REVOKE ALL ON TABLE public.stale_items FROM anon, authenticated;

-- item_events：service_role 仅可 INSERT/SELECT，禁止 UPDATE/DELETE/TRUNCATE
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.item_events FROM service_role;
GRANT SELECT, INSERT ON TABLE public.item_events TO service_role;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER items_set_updated_at
  BEFORE UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER goals_set_updated_at
  BEFORE UPDATE ON public.goals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- 校验令牌并绑定授权到注册挑战（同一事务）；挑战记录 registration_mode
CREATE OR REPLACE FUNCTION public.authorize_and_create_registration_challenge(
  p_challenge text,
  p_expires_at timestamptz,
  p_token_hash text,
  p_mode text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reg public.webauthn_registration%ROWTYPE;
  v_id uuid;
  v_reg_mode text;
BEGIN
  SELECT * INTO v_reg
  FROM public.webauthn_registration
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration config missing'
      USING ERRCODE = 'XJ404';
  END IF;

  IF p_mode = 'bootstrap' THEN
    -- 只要已有任何凭据，BOOTSTRAP_TOKEN 一律失效
    IF EXISTS (SELECT 1 FROM public.webauthn_credentials LIMIT 1) THEN
      RAISE EXCEPTION 'bootstrap disabled: credentials already exist'
        USING ERRCODE = 'XJ403';
    END IF;
    -- 无凭据时允许重试（中途失败不永久作废）；consumed 仅在 verify 成功时写入
    v_reg_mode := 'bootstrap';
  ELSIF p_mode = 'one_time' THEN
    IF v_reg.one_time_token_hash IS NULL
       OR v_reg.one_time_token_hash IS DISTINCT FROM p_token_hash THEN
      RAISE EXCEPTION 'invalid one-time token'
        USING ERRCODE = 'XJ403';
    END IF;
    IF v_reg.one_time_token_expires_at IS NOT NULL
       AND v_reg.one_time_token_expires_at < now() THEN
      RAISE EXCEPTION 'one-time token expired'
        USING ERRCODE = 'XJ403';
    END IF;
    UPDATE public.webauthn_registration
    SET one_time_token_hash = NULL,
        one_time_token_expires_at = NULL,
        updated_at = now()
    WHERE id = 1;
    v_reg_mode := 'invite';
  ELSE
    RAISE EXCEPTION 'invalid mode'
      USING ERRCODE = 'XJ403';
  END IF;

  INSERT INTO public.webauthn_challenges (
    challenge, purpose, expires_at, authorized, registration_mode
  )
  VALUES (p_challenge, 'register', p_expires_at, true, v_reg_mode)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 复查授权、写入凭据、关闭注册（同一事务）
-- 锁住注册配置行；bootstrap 要求尚无凭据；成功后删除其余注册挑战
CREATE OR REPLACE FUNCTION public.complete_webauthn_registration(
  p_challenge_id uuid,
  p_credential_id text,
  p_public_key text,
  p_counter bigint,
  p_transports text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ch public.webauthn_challenges%ROWTYPE;
BEGIN
  -- 串行化注册完成，防止同一令牌多挑战并发写入
  PERFORM 1
  FROM public.webauthn_registration
  WHERE id = 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration config missing'
      USING ERRCODE = 'XJ404';
  END IF;

  DELETE FROM public.webauthn_challenges
  WHERE id = p_challenge_id
    AND purpose = 'register'
    AND authorized = true
    AND expires_at > now()
  RETURNING * INTO v_ch;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid or unauthorized registration challenge'
      USING ERRCODE = 'XJ403';
  END IF;

  IF v_ch.registration_mode = 'bootstrap' THEN
    IF EXISTS (SELECT 1 FROM public.webauthn_credentials LIMIT 1) THEN
      RAISE EXCEPTION 'bootstrap disabled: credentials already exist'
        USING ERRCODE = 'XJ409';
    END IF;
  ELSIF v_ch.registration_mode IS DISTINCT FROM 'invite' THEN
    RAISE EXCEPTION 'invalid registration mode'
      USING ERRCODE = 'XJ403';
  END IF;

  INSERT INTO public.webauthn_credentials (
    credential_id, public_key, counter, transports
  )
  VALUES (
    p_credential_id, p_public_key, p_counter, COALESCE(p_transports, '{}')
  );

  UPDATE public.webauthn_registration
  SET open = false,
      one_time_token_hash = NULL,
      one_time_token_expires_at = NULL,
      bootstrap_consumed_at = CASE
        WHEN v_ch.registration_mode = 'bootstrap'
          THEN COALESCE(bootstrap_consumed_at, now())
        ELSE bootstrap_consumed_at
      END,
      updated_at = now()
  WHERE id = 1;

  -- 成功后作废其余所有注册挑战（含并发开出的）
  DELETE FROM public.webauthn_challenges
  WHERE purpose = 'register';
END;
$$;

-- 抢占挑战码（delete … returning）
CREATE OR REPLACE FUNCTION public.claim_webauthn_challenge(
  p_id uuid,
  p_purpose text,
  p_item_id uuid DEFAULT NULL
)
RETURNS public.webauthn_challenges
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.webauthn_challenges%ROWTYPE;
BEGIN
  IF p_purpose = 'step_up' THEN
    IF p_item_id IS NULL THEN
      RAISE EXCEPTION 'step_up requires item_id';
    END IF;
    DELETE FROM public.webauthn_challenges
    WHERE id = p_id
      AND purpose = 'step_up'
      AND item_id IS NOT NULL
      AND item_id = p_item_id
      AND expires_at > now()
    RETURNING * INTO v_row;
  ELSE
    DELETE FROM public.webauthn_challenges
    WHERE id = p_id
      AND purpose = p_purpose
      AND expires_at > now()
    RETURNING * INTO v_row;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'challenge not found or expired';
  END IF;

  RETURN v_row;
END;
$$;

-- 条件更新事项状态并写事件（同一事务）
CREATE OR REPLACE FUNCTION public.apply_item_decision(
  p_item_id uuid,
  p_action public.item_action,
  p_expected_content_hash text,
  p_option_key text,
  p_reply_text text,
  p_credential_id text,
  p_verified_at timestamptz,
  p_next_status public.item_status
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.items%ROWTYPE;
  v_event public.item_events%ROWTYPE;
  v_keys text[];
BEGIN
  SELECT * INTO v_item
  FROM public.items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found'
      USING ERRCODE = 'XJ404';
  END IF;

  IF v_item.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'item is not open'
      USING ERRCODE = 'XJ409';
  END IF;

  IF v_item.content_hash IS DISTINCT FROM p_expected_content_hash THEN
    RAISE EXCEPTION 'content_hash mismatch'
      USING ERRCODE = 'XJ409';
  END IF;

  -- kind 允许的决定
  IF v_item.kind = 'approval' AND p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'action not allowed for kind'
      USING ERRCODE = 'XJ403';
  ELSIF v_item.kind IN ('todo', 'question_to_user', 'question_from_user', 'waiting')
        AND p_action IS DISTINCT FROM 'reply' THEN
    RAISE EXCEPTION 'action not allowed for kind'
      USING ERRCODE = 'XJ403';
  END IF;

  IF p_option_key IS NOT NULL THEN
    SELECT array_agg(opt->>'key')
    INTO v_keys
    FROM jsonb_array_elements(COALESCE(v_item.options, '[]'::jsonb)) AS opt;

    IF v_keys IS NULL OR NOT (p_option_key = ANY (v_keys)) THEN
      RAISE EXCEPTION 'invalid option_key'
        USING ERRCODE = 'XJ403';
    END IF;
  END IF;

  UPDATE public.items
  SET status = p_next_status,
      last_activity_at = p_verified_at,
      updated_at = p_verified_at
  WHERE id = p_item_id
    AND status = 'open'
    AND content_hash = p_expected_content_hash
  RETURNING * INTO v_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conditional update failed'
      USING ERRCODE = 'XJ409';
  END IF;

  INSERT INTO public.item_events (
    item_id, actor_type, action, option_key, reply_text,
    credential_id, verified_at, content_hash
  )
  VALUES (
    p_item_id, 'user', p_action, p_option_key, p_reply_text,
    p_credential_id, p_verified_at, p_expected_content_hash
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item),
    'event', to_jsonb(v_event)
  );
END;
$$;

-- 未登录 options 限流 + 清理过期挑战
CREATE OR REPLACE FUNCTION public.rate_limit_auth_options(
  p_scope_key text,
  p_limit int,
  p_window_seconds int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.login_attempts%ROWTYPE;
  v_allowed boolean := true;
BEGIN
  DELETE FROM public.webauthn_challenges WHERE expires_at <= now();

  SELECT * INTO v_row
  FROM public.login_attempts
  WHERE scope = 'auth_options' AND scope_key = p_scope_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.login_attempts (scope, scope_key, failed_count, updated_at)
    VALUES ('auth_options', p_scope_key, 1, now());
    RETURN true;
  END IF;

  IF v_row.updated_at < now() - make_interval(secs => p_window_seconds) THEN
    UPDATE public.login_attempts
    SET failed_count = 1, updated_at = now(), locked_until = NULL
    WHERE id = v_row.id;
    RETURN true;
  END IF;

  IF v_row.failed_count >= p_limit THEN
    v_allowed := false;
  ELSE
    UPDATE public.login_attempts
    SET failed_count = v_row.failed_count + 1, updated_at = now()
    WHERE id = v_row.id;
  END IF;

  RETURN v_allowed;
END;
$$;

-- 已登录签发新设备一次性登记令牌（只存哈希）
CREATE OR REPLACE FUNCTION public.set_registration_one_time_token(
  p_token_hash text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.webauthn_registration
  SET one_time_token_hash = p_token_hash,
      one_time_token_expires_at = p_expires_at,
      updated_at = now()
  WHERE id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration config missing';
  END IF;
END;
$$;

-- 注册 options 按 IP 限流
CREATE OR REPLACE FUNCTION public.rate_limit_register_options(
  p_scope_key text,
  p_limit int,
  p_window_seconds int
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.login_attempts%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.login_attempts
  WHERE scope = 'register_options' AND scope_key = p_scope_key
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.login_attempts (scope, scope_key, failed_count, updated_at)
    VALUES ('register_options', p_scope_key, 1, now());
    RETURN true;
  END IF;

  IF v_row.updated_at < now() - make_interval(secs => p_window_seconds) THEN
    UPDATE public.login_attempts
    SET failed_count = 1, updated_at = now(), locked_until = NULL
    WHERE id = v_row.id;
    RETURN true;
  END IF;

  IF v_row.failed_count >= p_limit THEN
    RETURN false;
  END IF;

  UPDATE public.login_attempts
  SET failed_count = v_row.failed_count + 1, updated_at = now()
  WHERE id = v_row.id;
  RETURN true;
END;
$$;

-- 姐妹 PATCH：单事务 FOR UPDATE，不回写旧 status；冲突则失败
CREATE OR REPLACE FUNCTION public.apply_agent_item_patch(
  p_item_id uuid,
  p_agent_id uuid,
  p_expected_status public.item_status,
  p_expected_content_hash text,
  p_new_content_hash text,
  p_set_status boolean,
  p_new_status public.item_status,
  p_title text,
  p_body text,
  p_options jsonb,
  p_project text,
  p_due_at timestamptz,
  p_touch_due_at boolean,
  p_source_url text,
  p_touch_source_url boolean,
  p_kind public.item_kind,
  p_event_action public.item_action
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.items%ROWTYPE;
  v_event public.item_events%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_item
  FROM public.items
  WHERE id = p_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'item not found'
      USING ERRCODE = 'XJ404';
  END IF;

  IF v_item.agent_id IS DISTINCT FROM p_agent_id THEN
    RAISE EXCEPTION 'forbidden: item belongs to another agent'
      USING ERRCODE = 'XJ403';
  END IF;

  IF v_item.status IS DISTINCT FROM p_expected_status
     OR v_item.content_hash IS DISTINCT FROM p_expected_content_hash THEN
    RAISE EXCEPTION 'conflict: status or content changed'
      USING ERRCODE = 'XJ409';
  END IF;

  -- 审批仍 open 时禁止标 done
  IF p_set_status
     AND p_new_status = 'done'
     AND v_item.kind = 'approval'
     AND v_item.status = 'open' THEN
    RAISE EXCEPTION 'not allowed: open approval may only be withdrawn'
      USING ERRCODE = 'XJ403';
  END IF;

  IF p_set_status
     AND p_new_status IS NOT NULL
     AND p_new_status NOT IN ('done', 'withdrawn', 'open') THEN
    RAISE EXCEPTION 'not allowed status'
      USING ERRCODE = 'XJ403';
  END IF;

  UPDATE public.items
  SET
    title = COALESCE(p_title, title),
    body = COALESCE(p_body, body),
    options = COALESCE(p_options, options),
    project = COALESCE(p_project, project),
    due_at = CASE WHEN p_touch_due_at THEN p_due_at ELSE due_at END,
    source_url = CASE WHEN p_touch_source_url THEN p_source_url ELSE source_url END,
    kind = COALESCE(p_kind, kind),
    content_hash = p_new_content_hash,
    status = CASE
      WHEN p_set_status AND p_new_status IS NOT NULL THEN p_new_status
      ELSE status
    END,
    updated_at = v_now,
    last_activity_at = v_now
  WHERE id = p_item_id
    AND agent_id = p_agent_id
    AND status = p_expected_status
    AND content_hash = p_expected_content_hash
  RETURNING * INTO v_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conflict: conditional update failed'
      USING ERRCODE = 'XJ409';
  END IF;

  INSERT INTO public.item_events (
    item_id, actor_type, agent_id, action, content_hash
  )
  VALUES (
    p_item_id, 'agent', p_agent_id, p_event_action, p_new_content_hash
  )
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'failed to write event'
      USING ERRCODE = 'XJ409';
  END IF;

  RETURN jsonb_build_object(
    'item', to_jsonb(v_item),
    'event', to_jsonb(v_event)
  );
END;
$$;

-- 单 scope 原子失败计数（与 nextFailureState 对齐：阈值内累加，达阈锁住并清零计数）
CREATE OR REPLACE FUNCTION public._bump_login_failure(
  p_scope text,
  p_scope_key text,
  p_max_failures int,
  p_lock_minutes int
)
RETURNS boolean
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

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN true;
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until <= now() THEN
    v_next := 1;
  ELSIF v_row.failed_count > 0 THEN
    v_next := v_row.failed_count + 1;
  ELSE
    v_next := 1;
  END IF;

  IF v_next >= p_max_failures THEN
    UPDATE public.login_attempts
    SET failed_count = 0,
        locked_until = now() + make_interval(mins => p_lock_minutes),
        updated_at = now()
    WHERE id = v_row.id;
    RETURN true;
  END IF;

  UPDATE public.login_attempts
  SET failed_count = v_next,
      locked_until = NULL,
      updated_at = now()
  WHERE id = v_row.id;
  RETURN false;
END;
$$;

-- 登录失败计数：单事务原子 upsert/increment（策略参数与 TS 对齐：5 次 / 15 分钟）
CREATE OR REPLACE FUNCTION public.record_login_failure_atomic(
  p_ip text,
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
  v_global_locked boolean;
BEGIN
  v_ip_locked := public._bump_login_failure(
    'ip', p_ip, p_max_failures, p_lock_minutes
  );
  v_global_locked := public._bump_login_failure(
    'global', 'all', p_max_failures, p_lock_minutes
  );
  RETURN jsonb_build_object('locked', (v_ip_locked OR v_global_locked));
END;
$$;

-- 所有 RPC：收回 public/anon/authenticated 的 EXECUTE，仅 service_role
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'authorize_and_create_registration_challenge',
        'complete_webauthn_registration',
        'claim_webauthn_challenge',
        'apply_item_decision',
        'rate_limit_auth_options',
        'rate_limit_register_options',
        'set_registration_one_time_token',
        'apply_agent_item_patch',
        'record_login_failure_atomic',
        '_bump_login_failure',
        'forbid_item_events_mutation',
        'set_updated_at'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END;
$$;
