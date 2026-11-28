-- 移除 item_kind 枚举值 question_to_user / question_from_user。
-- 顺序：审计痕迹 → 转成 todo（不碰加密字段 / content_hash）→ 收紧枚举 → 更新 RPC。
-- content_hash 含 kind，迁移无法在不解密的前提下重算；保留原 hash。
-- 部署后可用 scripts/encrypt-existing-fields.ts --rehash-only 对齐 HMAC。

-- 1) 非加密审计：item_events.option_key 记录原 kind（时间线会显示为「更新 · 选项「migrated_from:…」」）
INSERT INTO public.item_events (
  item_id, actor_type, agent_id, action, option_key, content_hash
)
SELECT
  id,
  'agent',
  agent_id,
  'update',
  'migrated_from:' || kind::text,
  content_hash
FROM public.items
WHERE kind IN ('question_to_user', 'question_from_user');

-- 2) 先转换存量，再收紧约束
UPDATE public.items
SET kind = 'todo',
    updated_at = now()
WHERE kind IN ('question_to_user', 'question_from_user');

-- 3) 更新决定 RPC：去掉已废弃 kind 分支（签名不含 item_kind，可先替换）
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
  ELSIF v_item.kind IN ('todo', 'waiting')
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

-- 4) 收紧枚举：依赖旧 item_kind 签名的 PATCH RPC 先卸掉；
--    stale_items 视图依赖 items.kind，须先 DROP 再改列类型。
DROP FUNCTION IF EXISTS public.apply_agent_item_patch(
  uuid, uuid, public.item_status, text, text, boolean, public.item_status,
  text, text, jsonb, text, timestamptz, boolean, text, boolean, public.item_kind,
  public.item_action
);

DROP VIEW IF EXISTS public.stale_items;

CREATE TYPE public.item_kind_new AS ENUM (
  'approval',
  'todo',
  'waiting'
);

ALTER TABLE public.items
  ALTER COLUMN kind TYPE public.item_kind_new
  USING (kind::text::public.item_kind_new);

DROP TYPE public.item_kind;
ALTER TYPE public.item_kind_new RENAME TO item_kind;

CREATE OR REPLACE VIEW public.stale_items
WITH (security_invoker = true)
AS
SELECT *
FROM public.items
WHERE status = 'open'
  AND last_activity_at < (now() - interval '7 days');

REVOKE ALL ON TABLE public.stale_items FROM anon, authenticated;

-- 5) 按新枚举重建 PATCH RPC（逻辑与 20261127000002 一致）
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
