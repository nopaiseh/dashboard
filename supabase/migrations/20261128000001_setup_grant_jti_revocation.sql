-- setup-grant jti 单次消费：登记成功后写入，阻止同一 jti 被重放。
-- 合并到 main 后由 Supabase「Deploy to production」自动应用到 prod。

ALTER TABLE public.webauthn_registration
  ADD COLUMN IF NOT EXISTS consumed_setup_grant_jti text;

COMMENT ON COLUMN public.webauthn_registration.consumed_setup_grant_jti IS
  '最近一次 bootstrap 登记成功所消费的 xjg_setup_grant JWT jti；同 jti 不可再用于登记。';
