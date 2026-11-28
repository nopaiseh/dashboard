-- 玄机阁：通用 dashboard 区块（Plan C 一行标题 + 目标并入）。
-- 可在新 app 部署前安全执行：只加表/触发器，把 goals 改为只读；不删 goals，不改已有枚举。
-- goals 表保留一版只读；验证后另 PR 再删。

CREATE TYPE public.dashboard_block_type AS ENUM (
  'headline',
  'metric',
  'progress',
  'list',
  'text',
  'chart_series'
);

CREATE TYPE public.dashboard_block_action AS ENUM (
  'create',
  'update'
);

CREATE TABLE public.dashboard_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 明文：区域/分类（如 cpf、travel、home）
  category text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  -- 明文：拥有该分区的姐妹；迁移遗留无主目标可为 NULL
  agent_id uuid REFERENCES public.agents (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_sections_category_len CHECK (
    char_length(category) BETWEEN 1 AND 64
  )
);

-- 每位姐妹每个 category 至多一个分区；NULL agent 亦唯一（PG15+）
CREATE UNIQUE INDEX dashboard_sections_category_agent_uidx
  ON public.dashboard_sections (category, agent_id)
  NULLS NOT DISTINCT;

CREATE INDEX dashboard_sections_agent_id_idx
  ON public.dashboard_sections (agent_id);

CREATE INDEX dashboard_sections_sort_order_idx
  ON public.dashboard_sections (sort_order);

CREATE TABLE public.dashboard_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES public.dashboard_sections (id) ON DELETE RESTRICT,
  -- 明文：区块类型
  block_type public.dashboard_block_type NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  -- 明文：写入该块的姐妹；迁移遗留可为 NULL
  agent_id uuid REFERENCES public.agents (id),
  -- 应用层 AES-256-GCM 信封；标题/数值/列表等敏感内容只存密文
  payload text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dashboard_blocks_section_id_idx
  ON public.dashboard_blocks (section_id);

CREATE INDEX dashboard_blocks_agent_id_idx
  ON public.dashboard_blocks (agent_id);

CREATE INDEX dashboard_blocks_type_idx
  ON public.dashboard_blocks (block_type);

CREATE INDEX dashboard_blocks_sort_order_idx
  ON public.dashboard_blocks (section_id, sort_order);

CREATE TABLE public.dashboard_block_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id uuid NOT NULL REFERENCES public.dashboard_blocks (id) ON DELETE RESTRICT,
  actor_type public.actor_type NOT NULL,
  agent_id uuid REFERENCES public.agents (id),
  action public.dashboard_block_action NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dashboard_block_events_block_id_idx
  ON public.dashboard_block_events (block_id);

CREATE INDEX dashboard_block_events_created_at_idx
  ON public.dashboard_block_events (created_at);

CREATE OR REPLACE FUNCTION public.forbid_dashboard_block_events_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'dashboard_block_events is append-only: % not allowed', TG_OP;
END;
$$;

CREATE TRIGGER dashboard_block_events_no_update
  BEFORE UPDATE ON public.dashboard_block_events
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_dashboard_block_events_mutation();

CREATE TRIGGER dashboard_block_events_no_delete
  BEFORE DELETE ON public.dashboard_block_events
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_dashboard_block_events_mutation();

CREATE TRIGGER dashboard_block_events_no_truncate
  BEFORE TRUNCATE ON public.dashboard_block_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.forbid_dashboard_block_events_mutation();

CREATE TRIGGER dashboard_sections_set_updated_at
  BEFORE UPDATE ON public.dashboard_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER dashboard_blocks_set_updated_at
  BEFORE UPDATE ON public.dashboard_blocks
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.dashboard_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_block_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dashboard_sections FROM anon, authenticated;
REVOKE ALL ON TABLE public.dashboard_blocks FROM anon, authenticated;
REVOKE ALL ON TABLE public.dashboard_block_events FROM anon, authenticated;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.dashboard_block_events FROM service_role;
GRANT SELECT, INSERT ON TABLE public.dashboard_block_events TO service_role;

-- goals：一版只读（不删表）。撤销写入并加触发器双保险。
CREATE OR REPLACE FUNCTION public.forbid_goals_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'goals is read-only: % not allowed (use dashboard_blocks; table drops after verification)',
    TG_OP;
END;
$$;

CREATE TRIGGER goals_no_insert
  BEFORE INSERT ON public.goals
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_goals_mutation();

CREATE TRIGGER goals_no_update
  BEFORE UPDATE ON public.goals
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_goals_mutation();

CREATE TRIGGER goals_no_delete
  BEFORE DELETE ON public.goals
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_goals_mutation();

CREATE TRIGGER goals_no_truncate
  BEFORE TRUNCATE ON public.goals
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.forbid_goals_mutation();

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.goals FROM service_role;
GRANT SELECT ON TABLE public.goals TO service_role;

COMMENT ON TABLE public.dashboard_sections IS
  'Dashboard areas/categories; plaintext: category, sort_order, agent_id, timestamps.';
COMMENT ON TABLE public.dashboard_blocks IS
  'Dashboard blocks; plaintext: block_type, sort_order, agent_id, timestamps; payload encrypted.';
COMMENT ON TABLE public.goals IS
  'DEPRECATED read-only: migrated to dashboard_blocks (progress). Drop after verification.';
