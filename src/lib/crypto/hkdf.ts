import "server-only";

import { hkdfSync } from "node:crypto";
import { getSessionSecret } from "@/lib/env";

/** step-up 绑定串专用；不得与会话 JWT 共用原始 SESSION_SECRET。 */
export const AGENT_TOKEN_STEPUP_HKDF_INFO = "xjg-agent-token-stepup-v1";
/** migrate-goals page recent-auth cookie（≤5 min）。 */
export const MIGRATE_GOALS_STEPUP_HKDF_INFO = "xjg-migrate-goals-stepup-v1";
const HKDF_SALT = "xjg-hkdf-salt-v1";

/** 从 SESSION_SECRET 经 HKDF-SHA256 派生 32 字节密钥。 */
export function deriveAgentTokenStepUpKey(): Uint8Array {
  const ikm = Buffer.from(getSessionSecret(), "utf8");
  const salt = Buffer.from(HKDF_SALT, "utf8");
  const info = Buffer.from(AGENT_TOKEN_STEPUP_HKDF_INFO, "utf8");
  return new Uint8Array(hkdfSync("sha256", ikm, salt, info, 32));
}

export function deriveMigrateGoalsStepUpKey(): Uint8Array {
  const ikm = Buffer.from(getSessionSecret(), "utf8");
  const salt = Buffer.from(HKDF_SALT, "utf8");
  const info = Buffer.from(MIGRATE_GOALS_STEPUP_HKDF_INFO, "utf8");
  return new Uint8Array(hkdfSync("sha256", ikm, salt, info, 32));
}
