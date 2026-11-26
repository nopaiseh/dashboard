/**
 * 服务器端环境变量读取。
 * 不在此处硬编码任何密钥；缺失时抛错（构建/测试可 mock）。
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export function getSupabaseUrl(): string {
  return required("SUPABASE_URL");
}

export function getSupabaseServiceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

export function getSessionSecret(): string {
  return required("SESSION_SECRET");
}

export function getWebAuthnRpID(): string {
  return optional("WEBAUTHN_RP_ID", "desk.nopaiseh.com");
}

export function getWebAuthnRpName(): string {
  return optional("WEBAUTHN_RP_NAME", "玄机阁");
}

export function getWebAuthnOrigin(): string {
  return optional("WEBAUTHN_ORIGIN", "https://desk.nopaiseh.com");
}

export function getSiteName(): string {
  return optional("SITE_NAME", "玄机阁");
}

/** 构建期 / 无 DB 场景：是否具备运行时密钥。 */
export function hasRuntimeSecrets(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SESSION_SECRET,
  );
}
