-- Agent token category allow-lists + plaintext block_key for upsert uniqueness.
-- Merging to main applies this on prod automatically (Deploy to production).
-- Do NOT wrap in BEGIN/COMMIT (Supabase already wraps each migration).

-- ---------------------------------------------------------------------------
-- 1) agent_tokens.allowed_categories
-- ---------------------------------------------------------------------------
ALTER TABLE public.agent_tokens
  ADD COLUMN IF NOT EXISTS allowed_categories text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.agent_tokens.allowed_categories IS
  'Normalized lowercase dashboard section categories this token may write. Empty = no category writes. Never default to all.';

-- Backfill:
-- - Tokens for agents that own a `cpf` section get
--   (their existing section categories) ∪ {'bank'}
--   so the CPF sister can write both sensitive categories.
-- - All other tokens get only their agent's existing section categories.
-- - Agents with no sections → '{}' (cannot write). Never default to all.
-- No agent ids are hardcoded — CPF ownership is derived from sections.
UPDATE public.agent_tokens t
SET allowed_categories = (
  SELECT COALESCE(
    (
      SELECT array_agg(DISTINCT c ORDER BY c)
      FROM (
        SELECT lower(trim(s.category)) AS c
        FROM public.dashboard_sections s
        WHERE s.agent_id = t.agent_id
          AND char_length(trim(s.category)) > 0
        UNION
        SELECT 'bank'::text AS c
        WHERE EXISTS (
          SELECT 1
          FROM public.dashboard_sections s2
          WHERE s2.agent_id = t.agent_id
            AND lower(trim(s2.category)) = 'cpf'
        )
      ) cats
    ),
    '{}'::text[]
  )
);

-- PG forbids subqueries in CHECK; use an IMMUTABLE helper instead.
CREATE OR REPLACE FUNCTION public.allowed_categories_are_normalized(cats text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT cats = '{}'::text[]
    OR (
      SELECT bool_and(
        char_length(c) BETWEEN 1 AND 64
        AND c = lower(c)
        AND c = trim(c)
      )
      FROM unnest(cats) AS c
    );
$$;

ALTER TABLE public.agent_tokens
  DROP CONSTRAINT IF EXISTS agent_tokens_allowed_categories_normalized;

ALTER TABLE public.agent_tokens
  ADD CONSTRAINT agent_tokens_allowed_categories_normalized CHECK (
    public.allowed_categories_are_normalized(allowed_categories)
  );

-- RLS / grants unchanged: table already RLS-on; anon/authenticated revoked;
-- service_role retains existing access.

-- Sensitive categories (cpf / bank): at most one section globally (any agent).
-- Category names only — never agent ids.
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_sections_sensitive_category_uidx
  ON public.dashboard_sections (lower(trim(category)))
  WHERE lower(trim(category)) IN ('cpf', 'bank');

-- Token allow-list: sensitive categories may not appear on another agent's
-- active token, and may not be granted when another agent owns that section.
CREATE OR REPLACE FUNCTION public.enforce_sensitive_category_token_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cat text;
BEGIN
  IF NEW.revoked_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.allowed_categories IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_cat IN ARRAY NEW.allowed_categories
  LOOP
    IF lower(trim(v_cat)) NOT IN ('cpf', 'bank') THEN
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.agent_tokens t
      WHERE t.revoked_at IS NULL
        AND t.agent_id IS DISTINCT FROM NEW.agent_id
        AND t.id IS DISTINCT FROM NEW.id
        AND lower(trim(v_cat)) = ANY (
          SELECT lower(trim(c)) FROM unnest(t.allowed_categories) AS c
        )
    ) THEN
      RAISE EXCEPTION 'sensitive category already granted to another agent'
        USING ERRCODE = '23505';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.dashboard_sections s
      WHERE s.agent_id IS DISTINCT FROM NEW.agent_id
        AND s.agent_id IS NOT NULL
        AND lower(trim(s.category)) = lower(trim(v_cat))
    ) THEN
      RAISE EXCEPTION 'sensitive category section owned by another agent'
        USING ERRCODE = '23505';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agent_tokens_sensitive_category_exclusivity
  ON public.agent_tokens;
CREATE TRIGGER agent_tokens_sensitive_category_exclusivity
  BEFORE INSERT OR UPDATE OF allowed_categories, revoked_at, agent_id
  ON public.agent_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sensitive_category_token_exclusivity();

-- Section writes: sensitive category already held by another agent → reject.
CREATE OR REPLACE FUNCTION public.enforce_sensitive_category_section_exclusivity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.category IS NULL OR lower(trim(NEW.category)) NOT IN ('cpf', 'bank') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.dashboard_sections s
    WHERE s.id IS DISTINCT FROM NEW.id
      AND s.agent_id IS DISTINCT FROM NEW.agent_id
      AND s.agent_id IS NOT NULL
      AND lower(trim(s.category)) = lower(trim(NEW.category))
  ) THEN
    RAISE EXCEPTION 'sensitive category section owned by another agent'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS dashboard_sections_sensitive_category_exclusivity
  ON public.dashboard_sections;
CREATE TRIGGER dashboard_sections_sensitive_category_exclusivity
  BEFORE INSERT OR UPDATE OF category, agent_id
  ON public.dashboard_sections
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_sensitive_category_section_exclusivity();

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

-- No prior (section_id, block_key) unique constraint existed (key lived only in
-- ciphertext). Add partial unique index so upsert can ON CONFLICT atomically.
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_blocks_section_block_key_uidx
  ON public.dashboard_blocks (section_id, block_key)
  WHERE block_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Update create / patch RPCs to maintain block_key column
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

  IF v_section.agent_id IS DISTINCT FROM p_agent_id THEN
    RAISE EXCEPTION 'forbidden: section belongs to another agent'
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
    block_key = CASE
      WHEN p_touch_block_key THEN p_block_key
      ELSE block_key
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

-- ---------------------------------------------------------------------------
-- 4) Atomic upsert by (section_id, block_key)
-- ---------------------------------------------------------------------------
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

  -- Section row lock serializes writers for this section; unique index is the
  -- safety net. Prefer INSERT … ON CONFLICT for the data write.
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
    updated_at = now()
  WHERE public.dashboard_blocks.agent_id IS NOT DISTINCT FROM p_agent_id
  RETURNING * INTO v_block;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden: block belongs to another agent'
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
