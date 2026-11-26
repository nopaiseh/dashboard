-- 结果读取回执：姐妹确认已读本人决定。
-- result_read_at NULL + 已决状态 → 待姐妹读取；非 NULL → 已读取。
-- open 状态不展示读取芯片（由应用层判定）。

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS result_read_at timestamptz;

COMMENT ON COLUMN public.items.result_read_at IS
  '姐妹确认已读本人决定的时间；NULL 表示待读取（仅对已决状态有意义）';

CREATE INDEX IF NOT EXISTS items_result_unread_idx
  ON public.items (agent_id, updated_at)
  WHERE result_read_at IS NULL AND status <> 'open';

-- 本人新决定：清空回执，等待姐妹再读
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
      updated_at = p_verified_at,
      result_read_at = NULL
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

-- 姐妹 PATCH：内容重开为 open 时清空回执
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
  v_next_status public.item_status;
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

  v_next_status := CASE
    WHEN p_set_status AND p_new_status IS NOT NULL THEN p_new_status
    ELSE v_item.status
  END;

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
    status = v_next_status,
    updated_at = v_now,
    last_activity_at = v_now,
    result_read_at = CASE
      WHEN v_next_status = 'open' THEN NULL
      ELSE result_read_at
    END
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

-- 姐妹回写已读（Bearer agent token → resolveAgentFromRequest → 本 RPC）
CREATE OR REPLACE FUNCTION public.mark_item_result_read(
  p_item_id uuid,
  p_agent_id uuid
)
RETURNS public.items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.items%ROWTYPE;
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

  IF v_item.status = 'open' THEN
    RAISE EXCEPTION 'item has no decision to acknowledge'
      USING ERRCODE = 'XJ409';
  END IF;

  IF v_item.result_read_at IS NOT NULL THEN
    RETURN v_item;
  END IF;

  UPDATE public.items
  SET result_read_at = v_now,
      updated_at = v_now
  WHERE id = p_item_id
    AND agent_id = p_agent_id
    AND status <> 'open'
    AND result_read_at IS NULL
  RETURNING * INTO v_item;

  IF NOT FOUND THEN
    SELECT * INTO v_item FROM public.items WHERE id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'item not found'
        USING ERRCODE = 'XJ404';
    END IF;
  END IF;

  RETURN v_item;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_item_result_read(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_item_result_read(uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_item_result_read(uuid, uuid) TO service_role;

-- 替换后的决策 / PATCH 函数：同样只给 service_role
REVOKE ALL ON FUNCTION public.apply_item_decision(
  uuid, public.item_action, text, text, text, text, timestamptz, public.item_status
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_item_decision(
  uuid, public.item_action, text, text, text, text, timestamptz, public.item_status
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_item_decision(
  uuid, public.item_action, text, text, text, text, timestamptz, public.item_status
) TO service_role;

REVOKE ALL ON FUNCTION public.apply_agent_item_patch(
  uuid, uuid, public.item_status, text, text, boolean, public.item_status,
  text, text, jsonb, text, timestamptz, boolean, text, boolean, public.item_kind,
  public.item_action
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_agent_item_patch(
  uuid, uuid, public.item_status, text, text, boolean, public.item_status,
  text, text, jsonb, text, timestamptz, boolean, text, boolean, public.item_kind,
  public.item_action
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_agent_item_patch(
  uuid, uuid, public.item_status, text, text, boolean, public.item_status,
  text, text, jsonb, text, timestamptz, boolean, text, boolean, public.item_kind,
  public.item_action
) TO service_role;
