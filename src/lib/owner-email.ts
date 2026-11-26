import "server-only";

/**
 * 服务器专用：唯一允许发起首次登记魔法链接的邮箱。
 * 未配置或空 → 视为未启用（永不匹配）。
 */
export function getOwnerEmail(): string | null {
  const value = process.env.OWNER_EMAIL?.trim();
  if (!value) {
    return null;
  }
  return value.toLowerCase();
}

/** 大小写不敏感比对；未配置 OWNER_EMAIL 时恒为 false。 */
export function matchesOwnerEmail(presented: string): boolean {
  const owner = getOwnerEmail();
  if (!owner) {
    return false;
  }
  const normalized = presented.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) {
    return false;
  }
  return normalized === owner;
}
