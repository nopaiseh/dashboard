import "server-only";

import { randomBytes } from "node:crypto";

/** 姐妹 Bearer 令牌前缀（明文仅签发时返回一次）。 */
export const AGENT_TOKEN_PREFIX = "xjg_at_";

/** ≥256 bit 安全随机；库中只存 hashAgentToken(明文)。 */
export function generateAgentBearerToken(): string {
  return `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** 列表展示用：令牌行 id 去横线后末 8 位（绝不涉及哈希/明文）。 */
export function agentTokenIdSuffix(tokenId: string): string {
  return tokenId.replace(/-/g, "").slice(-8);
}
