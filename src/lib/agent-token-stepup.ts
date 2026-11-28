import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { deriveAgentTokenStepUpKey } from "@/lib/crypto/hkdf";

export const AGENT_TOKEN_STEPUP_AUD = "xjg-agent-token-stepup";
export const AGENT_TOKEN_STEPUP_TTL_MS = 5 * 60 * 1000;
/** JWT claim；与会话 typ=session 互斥。 */
export const AGENT_TOKEN_STEPUP_TYP = "agent_token_stepup";

export type AgentTokenStepUpAction =
  | "issue_agent_token"
  | "revoke_agent_token"
  | "create_agent"
  | "update_agent_token_categories";

export interface AgentTokenStepUpBinding {
  challengeId: string;
  action: AgentTokenStepUpAction;
  agentId?: string;
  tokenId?: string;
}

/**
 * 无迁移前提下：webauthn_challenges 无法存 agent_id / 新 purpose。
 * 用 HKDF(SESSION_SECRET, info=step-up) 派生密钥签发短时绑定
 * （不得用原始 SESSION_SECRET，否则可被 verifySessionToken 误收）。
 * 挑战行本身用 purpose=login 抢占（与 invite 相同；见 PR「后续建议」）。
 */
function stepUpKey(): Uint8Array {
  return deriveAgentTokenStepUpKey();
}

export async function createAgentTokenStepUpBinding(
  input: AgentTokenStepUpBinding,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const claims: Record<string, string> = {
    typ: AGENT_TOKEN_STEPUP_TYP,
    purpose: "agent_token_stepup",
    action: input.action,
    challenge_id: input.challengeId,
  };
  if (input.agentId) claims.agent_id = input.agentId;
  if (input.tokenId) claims.token_id = input.tokenId;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setAudience(AGENT_TOKEN_STEPUP_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + Math.floor(AGENT_TOKEN_STEPUP_TTL_MS / 1000))
    .sign(stepUpKey());
}

export async function verifyAgentTokenStepUpBinding(
  token: string,
  expected: AgentTokenStepUpBinding,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, stepUpKey(), {
      algorithms: ["HS256"],
      audience: AGENT_TOKEN_STEPUP_AUD,
      currentDate: now,
    });
    // 拒收会话令牌形态（即便签名碰巧通过）
    if ((payload as { typ?: string }).typ === "session") {
      return false;
    }
    if (
      payload.sub !== "owner" ||
      (payload as { typ?: string }).typ !== AGENT_TOKEN_STEPUP_TYP ||
      (payload as { purpose?: string }).purpose !== "agent_token_stepup" ||
      (payload as { action?: string }).action !== expected.action ||
      (payload as { challenge_id?: string }).challenge_id !==
        expected.challengeId
    ) {
      return false;
    }
    const agentId = (payload as { agent_id?: string }).agent_id;
    const tokenId = (payload as { token_id?: string }).token_id;
    if ((expected.agentId ?? undefined) !== (agentId ?? undefined)) {
      return false;
    }
    if ((expected.tokenId ?? undefined) !== (tokenId ?? undefined)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
