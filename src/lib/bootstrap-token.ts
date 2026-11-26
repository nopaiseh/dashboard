import { hashAgentToken, safeEqualHex } from "@/lib/crypto";

/** 启动令牌至少 32 字节（UTF-8）；不足视为未配置。 */
export const BOOTSTRAP_TOKEN_MIN_BYTES = 32;

/**
 * 读取已配置且长度合格的 BOOTSTRAP_TOKEN。
 * 长度不足或未设置 → null（视为未配置）。
 */
export function getConfiguredBootstrapToken(): string | null {
  const value = process.env.BOOTSTRAP_TOKEN;
  if (!value) {
    return null;
  }
  if (Buffer.byteLength(value, "utf8") < BOOTSTRAP_TOKEN_MIN_BYTES) {
    return null;
  }
  return value;
}

/**
 * 恒定时间比对：先各自 sha256，再用 timingSafeEqual 比哈希，避免明文长度泄露。
 * 未配置 / 过短 / 不匹配均返回 false。
 */
export function matchesBootstrapToken(presented: string): boolean {
  const presentedHash = hashAgentToken(presented);
  const configured = getConfiguredBootstrapToken();
  // 始终先哈希再 timingSafeEqual；未配置时与哑元哈希比较并返回 false
  const expectedHash = configured
    ? hashAgentToken(configured)
    : "0".repeat(64);
  const equal = safeEqualHex(presentedHash, expectedHash);
  return configured !== null && equal;
}

export function isBootstrapTokenConfigured(): boolean {
  return getConfiguredBootstrapToken() !== null;
}
