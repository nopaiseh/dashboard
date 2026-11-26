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

/** 首次注册启动令牌（明文仅存于环境变量；库中只记是否已消耗）。 */
export function getBootstrapToken(): string {
  return required("BOOTSTRAP_TOKEN");
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

export function hasRuntimeSecrets(): boolean {
  return Boolean(
    process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      process.env.SESSION_SECRET,
  );
}
