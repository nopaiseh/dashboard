export const SESSION_SECRET_MIN_BYTES = 32;

function isProductionBuild(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // 允许无密钥完成 next build（Vercel 编译）；运行时仍会失败
    if (isProductionBuild()) {
      if (name === "SUPABASE_URL") {
        return "https://build-placeholder.supabase.co";
      }
      return `build-placeholder-${name}`;
    }
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

/** SESSION_SECRET 须 ≥32 字节，否则视为未配置。 */
export function isSessionSecretConfigured(): boolean {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    return false;
  }
  return Buffer.byteLength(value, "utf8") >= SESSION_SECRET_MIN_BYTES;
}

export function getSessionSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || Buffer.byteLength(value, "utf8") < SESSION_SECRET_MIN_BYTES) {
    if (isProductionBuild()) {
      return "build-placeholder-session-secret-32b!!";
    }
    throw new Error(
      `SESSION_SECRET missing or shorter than ${SESSION_SECRET_MIN_BYTES} bytes`,
    );
  }
  return value;
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
      isSessionSecretConfigured(),
  );
}
