-- 玄机阁：核心 schema
-- 全部表启用 RLS，且不授予 anon/authenticated 任何策略；仅 service_role 访问。

-- Enums
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

-- agents：十二位姐妹
CREATE TABLE public.agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  area text NOT NULL DEFAULT '',
  bot_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- agent_tokens：Bearer 令牌哈希（sha256），可作废重发
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

-- items
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

-- item_events：只增不改
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

-- goals
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

-- daily_summaries
CREATE TABLE public.daily_summaries (
  date date PRIMARY KEY,
  content text NOT NULL,
  generated_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- webauthn_credentials：仅允许本人一个用户的多把设备密钥
CREATE TABLE public.webauthn_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- webauthn_registration：登记开关；第一把登记后关闭，加设备需一次性令牌
CREATE TABLE public.webauthn_registration (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  open boolean NOT NULL DEFAULT true,
  one_time_token_hash text,
  one_time_token_expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.webauthn_registration (id, open)
VALUES (1, true);

-- login_attempts：按来源 IP 与全站计数，连续失败 5 次锁 15 分钟
CREATE TABLE public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('ip', 'global')),
  scope_key text NOT NULL,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_key)
);

CREATE INDEX login_attempts_locked_until_idx
  ON public.login_attempts (locked_until)
  WHERE locked_until IS NOT NULL;

-- webauthn 挑战暂存（短时）
CREATE TABLE public.webauthn_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge text NOT NULL UNIQUE,
  purpose text NOT NULL CHECK (purpose IN ('login', 'register', 'step_up')),
  item_id uuid REFERENCES public.items (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webauthn_challenges_expires_at_idx
  ON public.webauthn_challenges (expires_at);

-- stale_items 视图：open 且超过 7 天无活动
CREATE OR REPLACE VIEW public.stale_items
WITH (security_invoker = true)
AS
SELECT *
FROM public.items
WHERE status = 'open'
  AND last_activity_at < (now() - interval '7 days');

-- RLS：全部开启，不创建任何 anon/authenticated 策略
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

-- 撤销 anon/authenticated 对表的默认权限（防御纵深）
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

-- updated_at 辅助触发器
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
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
