-- 玄机阁：通用 dashboard 区块（Plan C 一行标题 + 目标并入）。
-- 可在新 app 部署前安全执行：只加表/触发器/RPC，把 goals 改为只读；不删 goals，不改已有枚举。
-- goals 表保留一版只读；验证后另 PR 再删。
-- Do NOT wrap this file in BEGIN/COMMIT: Supabase already runs each migration
-- in a transaction; nested COMMIT breaks that protection
-- (https://supabase.com/kb/troubleshooting/partial-migrations-and-schema-inconsistencies-from-embedded-transactions-13ae82).
-- CI applies with `psql --single-transaction` so local/CI still test atomically.

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
  -- 应用层 AES-256-GCM 信封；无遗留明文。'' 或 v{digits}:… 信封。
  payload text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_blocks_payload_envelope CHECK (
    payload = '' OR payload ~ '^v[0-9]+:'
  )
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

-- 无 DELETE API：库层也收回 DELETE（anon/authenticated 已 REVOKE ALL）
REVOKE DELETE, TRUNCATE ON TABLE public.dashboard_blocks FROM service_role;
REVOKE DELETE, TRUNCATE ON TABLE public.dashboard_sections FROM service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dashboard_blocks TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.dashboard_sections TO service_role;

-- 姐妹新建区块 + 审计事件（单事务）
CREATE OR REPLACE FUNCTION public.create_dashboard_block(
  p_id uuid,
  p_section_id uuid,
  p_block_type public.dashboard_block_type,
  p_sort_order integer,
  p_agent_id uuid,
  p_payload text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_section public.dashboard_sections%ROWTYPE;
  v_block public.dashboard_blocks%ROWTYPE;
  v_event public.dashboard_block_events%ROWTYPE;
BEGIN
  SELECT * INTO v_section
  FROM public.dashboard_sections
  WHERE id = p_section_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'section not found'
      USING ERRCODE = 'XJ404';
  END IF;

  IF v_section.agent_id IS DISTINCT FROM p_agent_id THEN
    RAISE EXCEPTION 'forbidden: section belongs to another agent'
      USING ERRCODE = 'XJ403';
  END IF;

  INSERT INTO public.dashboard_blocks (
    id, section_id, block_type, sort_order, agent_id, payload
  )
  VALUES (
    p_id, p_section_id, p_block_type, p_sort_order, p_agent_id, p_payload
  )
  RETURNING * INTO v_block;

  INSERT INTO public.dashboard_block_events (
    block_id, actor_type, agent_id, action
  )
  VALUES (
    v_block.id, 'agent', p_agent_id, 'create'
  )
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'failed to write dashboard_block_events'
      USING ERRCODE = 'XJ409';
  END IF;

  RETURN jsonb_build_object(
    'block', to_jsonb(v_block),
    'event', to_jsonb(v_event)
  );
END;
$$;

-- 姐妹更新区块 + 审计事件（单事务）
CREATE OR REPLACE FUNCTION public.apply_agent_dashboard_block_patch(
  p_block_id uuid,
  p_agent_id uuid,
  p_touch_block_type boolean,
  p_block_type public.dashboard_block_type,
  p_touch_sort_order boolean,
  p_sort_order integer,
  p_touch_payload boolean,
  p_payload text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_block public.dashboard_blocks%ROWTYPE;
  v_event public.dashboard_block_events%ROWTYPE;
BEGIN
  SELECT * INTO v_block
  FROM public.dashboard_blocks
  WHERE id = p_block_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'block not found'
      USING ERRCODE = 'XJ404';
  END IF;

  IF v_block.agent_id IS DISTINCT FROM p_agent_id THEN
    RAISE EXCEPTION 'forbidden: block belongs to another agent'
      USING ERRCODE = 'XJ403';
  END IF;

  UPDATE public.dashboard_blocks
  SET
    block_type = CASE
      WHEN p_touch_block_type THEN p_block_type
      ELSE block_type
    END,
    sort_order = CASE
      WHEN p_touch_sort_order THEN p_sort_order
      ELSE sort_order
    END,
    payload = CASE
      WHEN p_touch_payload THEN p_payload
      ELSE payload
    END,
    updated_at = now()
  WHERE id = p_block_id
    AND agent_id = p_agent_id
  RETURNING * INTO v_block;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'conflict: conditional update failed'
      USING ERRCODE = 'XJ409';
  END IF;

  INSERT INTO public.dashboard_block_events (
    block_id, actor_type, agent_id, action
  )
  VALUES (
    p_block_id, 'agent', p_agent_id, 'update'
  )
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'failed to write dashboard_block_events'
      USING ERRCODE = 'XJ409';
  END IF;

  RETURN jsonb_build_object(
    'block', to_jsonb(v_block),
    'event', to_jsonb(v_event)
  );
END;
$$;

-- goals→progress 迁移：确保分区 + 插入区块 + 审计（单事务；幂等）
CREATE OR REPLACE FUNCTION public.migrate_dashboard_progress_block(
  p_preferred_section_id uuid,
  p_category text,
  p_section_sort_order integer,
  p_section_agent_id uuid,
  p_block_id uuid,
  p_block_sort_order integer,
  p_block_agent_id uuid,
  p_payload text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_section_id uuid;
  v_block public.dashboard_blocks%ROWTYPE;
  v_event public.dashboard_block_events%ROWTYPE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.dashboard_blocks WHERE id = p_block_id
  ) THEN
    RETURN jsonb_build_object(
      'status', 'already_migrated',
      'block_id', p_block_id
    );
  END IF;

  SELECT id INTO v_section_id
  FROM public.dashboard_sections
  WHERE category = p_category
    AND agent_id IS NOT DISTINCT FROM p_section_agent_id
  FOR UPDATE;

  IF v_section_id IS NULL THEN
    BEGIN
      INSERT INTO public.dashboard_sections (
        id, category, sort_order, agent_id
      )
      VALUES (
        p_preferred_section_id,
        p_category,
        p_section_sort_order,
        p_section_agent_id
      )
      RETURNING id INTO v_section_id;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT id INTO v_section_id
        FROM public.dashboard_sections
        WHERE category = p_category
          AND agent_id IS NOT DISTINCT FROM p_section_agent_id;
        IF v_section_id IS NULL THEN
          SELECT id INTO v_section_id
          FROM public.dashboard_sections
          WHERE id = p_preferred_section_id;
        END IF;
    END;
  END IF;

  IF v_section_id IS NULL THEN
    RAISE EXCEPTION 'failed to resolve dashboard section'
      USING ERRCODE = 'XJ409';
  END IF;

  BEGIN
    INSERT INTO public.dashboard_blocks (
      id, section_id, block_type, sort_order, agent_id, payload
    )
    VALUES (
      p_block_id,
      v_section_id,
      'progress',
      p_block_sort_order,
      p_block_agent_id,
      p_payload
    )
    RETURNING * INTO v_block;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object(
        'status', 'already_migrated',
        'block_id', p_block_id
      );
  END;

  -- Owner-run migration: actor_type = user (not a sister write).
  INSERT INTO public.dashboard_block_events (
    block_id, actor_type, agent_id, action
  )
  VALUES (
    v_block.id, 'user', p_block_agent_id, 'create'
  )
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'failed to write dashboard_block_events'
      USING ERRCODE = 'XJ409';
  END IF;

  RETURN jsonb_build_object(
    'status', 'inserted',
    'block', to_jsonb(v_block),
    'event', to_jsonb(v_event),
    'section_id', v_section_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_dashboard_block(
  uuid, uuid, public.dashboard_block_type, integer, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_dashboard_block(
  uuid, uuid, public.dashboard_block_type, integer, uuid, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_dashboard_block(
  uuid, uuid, public.dashboard_block_type, integer, uuid, text
) TO service_role;

REVOKE ALL ON FUNCTION public.apply_agent_dashboard_block_patch(
  uuid, uuid, boolean, public.dashboard_block_type, boolean, integer, boolean, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_agent_dashboard_block_patch(
  uuid, uuid, boolean, public.dashboard_block_type, boolean, integer, boolean, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_agent_dashboard_block_patch(
  uuid, uuid, boolean, public.dashboard_block_type, boolean, integer, boolean, text
) TO service_role;

REVOKE ALL ON FUNCTION public.migrate_dashboard_progress_block(
  uuid, text, integer, uuid, uuid, integer, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.migrate_dashboard_progress_block(
  uuid, text, integer, uuid, uuid, integer, uuid, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.migrate_dashboard_progress_block(
  uuid, text, integer, uuid, uuid, integer, uuid, text
) TO service_role;

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
  'Dashboard blocks; plaintext: block_type, sort_order, agent_id, timestamps; payload encrypted (v{N}: envelope or empty).';
COMMENT ON TABLE public.goals IS
  'DEPRECATED read-only: migrated to dashboard_blocks (progress). Drop after verification.';
