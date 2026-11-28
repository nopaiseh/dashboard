-- Per-category dashboard writers + plaintext block_key for upsert uniqueness.
-- Merging to main applies this on prod automatically (Deploy to production).
-- Do NOT wrap in BEGIN/COMMIT (Supabase already wraps each migration).

-- ---------------------------------------------------------------------------
-- 1) dashboard_writers: many writers per category (category, agent_id)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dashboard_writers (
  category text NOT NULL,
  agent_id uuid NOT NULL REFERENCES public.agents (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (category, agent_id),
  CONSTRAINT dashboard_writers_category_normalized CHECK (
    char_length(category) BETWEEN 1 AND 64
    AND category = lower(category)
    AND category = trim(category)
  )
);

COMMENT ON TABLE public.dashboard_writers IS
  'Owner-assigned writer agents per dashboard category (many-to-many). Empty list → all agent writes denied.';

COMMENT ON COLUMN public.dashboard_writers.category IS
  'Normalized lowercase dashboard section category.';

COMMENT ON COLUMN public.dashboard_writers.agent_id IS
  'Agent whose Bearer tokens may write this category. Set only by owner (session + step-up).';

CREATE INDEX IF NOT EXISTS dashboard_writers_agent_id_idx
  ON public.dashboard_writers (agent_id);

ALTER TABLE public.dashboard_writers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dashboard_writers FROM PUBLIC;
REVOKE ALL ON TABLE public.dashboard_writers FROM anon, authenticated;
-- service_role bypasses RLS; owner/agent APIs use the service client only.

-- Backfill: every agent that owns a section of a category becomes a writer.
-- No agent ids hardcoded.
INSERT INTO public.dashboard_writers (category, agent_id)
SELECT DISTINCT
  lower(trim(s.category)) AS category,
  s.agent_id
FROM public.dashboard_sections s
WHERE s.agent_id IS NOT NULL
  AND char_length(trim(s.category)) > 0
ON CONFLICT (category, agent_id) DO NOTHING;

-- bank writers = cpf writers (CPF sister(s) also write bank).
INSERT INTO public.dashboard_writers (category, agent_id, created_at)
SELECT 'bank', w.agent_id, now()
FROM public.dashboard_writers w
WHERE w.category = 'cpf'
ON CONFLICT (category, agent_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) dashboard_blocks.block_key (plaintext) + unique (section_id, block_key)
-- ---------------------------------------------------------------------------
ALTER TABLE public.dashboard_blocks
  ADD COLUMN IF NOT EXISTS block_key text;

COMMENT ON COLUMN public.dashboard_blocks.block_key IS
  'Optional plaintext slot key for uniqueness / upsert. Mirrored inside encrypted payload when set. Never a personal identifier.';

ALTER TABLE public.dashboard_blocks
  DROP CONSTRAINT IF EXISTS dashboard_blocks_block_key_len;

ALTER TABLE public.dashboard_blocks
  ADD CONSTRAINT dashboard_blocks_block_key_len CHECK (
    block_key IS NULL OR char_length(block_key) BETWEEN 1 AND 64
  );

CREATE UNIQUE INDEX IF NOT EXISTS dashboard_blocks_section_block_key_uidx
  ON public.dashboard_blocks (section_id, block_key)
  WHERE block_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Helper: is this agent among the writers for a category?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_dashboard_category_writer(
  p_agent_id uuid,
  p_category text
)
RETURNS boolean
LANGUAGE sql
STABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.dashboard_writers w
    WHERE w.category = lower(trim(p_category))
      AND w.agent_id = p_agent_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_dashboard_category_writer(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_dashboard_category_writer(uuid, text)
  FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_dashboard_category_writer(uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Update create / patch / upsert RPCs: writer gate (not section.agent_id)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_dashboard_block(
  uuid, uuid, public.dashboard_block_type, integer, uuid, text
);

CREATE OR REPLACE FUNCTION public.create_dashboard_block(
  p_id uuid,
  p_section_id uuid,
  p_block_type public.dashboard_block_type,
  p_sort_order integer,
  p_agent_id uuid,
  p_payload text,
  p_block_key text DEFAULT NULL
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

  IF NOT public.is_dashboard_category_writer(p_agent_id, v_section.category) THEN
    RAISE EXCEPTION 'forbidden: not category writer'
      USING ERRCODE = 'XJ403';
  END IF;

  INSERT INTO public.dashboard_blocks (
    id, section_id, block_type, sort_order, agent_id, payload, block_key
  )
  VALUES (
    p_id, p_section_id, p_block_type, p_sort_order, p_agent_id, p_payload, p_block_key
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

DROP FUNCTION IF EXISTS public.apply_agent_dashboard_block_patch(
  uuid, uuid, boolean, public.dashboard_block_type, boolean, integer, boolean, text
);

CREATE OR REPLACE FUNCTION public.apply_agent_dashboard_block_patch(
  p_block_id uuid,
  p_agent_id uuid,
  p_touch_block_type boolean,
  p_block_type public.dashboard_block_type,
  p_touch_sort_order boolean,
  p_sort_order integer,
  p_touch_payload boolean,
  p_payload text,
  p_touch_block_key boolean DEFAULT false,
  p_block_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_block public.dashboard_blocks%ROWTYPE;
  v_section public.dashboard_sections%ROWTYPE;
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

  SELECT * INTO v_section
  FROM public.dashboard_sections
  WHERE id = v_block.section_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'section not found'
      USING ERRCODE = 'XJ404';
  END IF;

  IF NOT public.is_dashboard_category_writer(p_agent_id, v_section.category) THEN
    RAISE EXCEPTION 'forbidden: not category writer'
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
    block_key = CASE
      WHEN p_touch_block_key THEN p_block_key
      ELSE block_key
    END,
    agent_id = p_agent_id,
    updated_at = now()
  WHERE id = p_block_id
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

CREATE OR REPLACE FUNCTION public.upsert_dashboard_block_by_key(
  p_id uuid,
  p_section_id uuid,
  p_block_key text,
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
  v_action public.dashboard_block_action;
  v_existing_id uuid;
  v_inserted boolean := false;
BEGIN
  IF p_block_key IS NULL OR char_length(p_block_key) = 0 THEN
    RAISE EXCEPTION 'block_key required'
      USING ERRCODE = 'XJ409';
  END IF;

  SELECT * INTO v_section
  FROM public.dashboard_sections
  WHERE id = p_section_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'section not found'
      USING ERRCODE = 'XJ404';
  END IF;

  IF NOT public.is_dashboard_category_writer(p_agent_id, v_section.category) THEN
    RAISE EXCEPTION 'forbidden: not category writer'
      USING ERRCODE = 'XJ403';
  END IF;

  SELECT id INTO v_existing_id
  FROM public.dashboard_blocks
  WHERE section_id = p_section_id
    AND block_key = p_block_key;

  INSERT INTO public.dashboard_blocks (
    id, section_id, block_type, sort_order, agent_id, payload, block_key
  )
  VALUES (
    p_id, p_section_id, p_block_type, p_sort_order, p_agent_id, p_payload, p_block_key
  )
  ON CONFLICT (section_id, block_key) WHERE block_key IS NOT NULL
  DO UPDATE SET
    block_type = EXCLUDED.block_type,
    sort_order = EXCLUDED.sort_order,
    payload = EXCLUDED.payload,
    agent_id = p_agent_id,
    updated_at = now()
  RETURNING * INTO v_block;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden: upsert failed'
      USING ERRCODE = 'XJ403';
  END IF;

  IF v_existing_id IS NULL THEN
    v_action := 'create';
    v_inserted := true;
  ELSE
    v_action := 'update';
    v_inserted := false;
  END IF;

  INSERT INTO public.dashboard_block_events (
    block_id, actor_type, agent_id, action
  )
  VALUES (
    v_block.id, 'agent', p_agent_id, v_action
  )
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'failed to write dashboard_block_events'
      USING ERRCODE = 'XJ409';
  END IF;

  RETURN jsonb_build_object(
    'block', to_jsonb(v_block),
    'event', to_jsonb(v_event),
    'inserted', v_inserted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_dashboard_block(
  uuid, uuid, public.dashboard_block_type, integer, uuid, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_dashboard_block(
  uuid, uuid, public.dashboard_block_type, integer, uuid, text, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_dashboard_block(
  uuid, uuid, public.dashboard_block_type, integer, uuid, text, text
) TO service_role;

REVOKE ALL ON FUNCTION public.apply_agent_dashboard_block_patch(
  uuid, uuid, boolean, public.dashboard_block_type, boolean, integer, boolean, text, boolean, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_agent_dashboard_block_patch(
  uuid, uuid, boolean, public.dashboard_block_type, boolean, integer, boolean, text, boolean, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_agent_dashboard_block_patch(
  uuid, uuid, boolean, public.dashboard_block_type, boolean, integer, boolean, text, boolean, text
) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_dashboard_block_by_key(
  uuid, uuid, text, public.dashboard_block_type, integer, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_dashboard_block_by_key(
  uuid, uuid, text, public.dashboard_block_type, integer, uuid, text
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_dashboard_block_by_key(
  uuid, uuid, text, public.dashboard_block_type, integer, uuid, text
) TO service_role;
