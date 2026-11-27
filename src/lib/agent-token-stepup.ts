import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { getSessionSecret } from "@/lib/env";

export const AGENT_TOKEN_STEPUP_AUD = "xjg-agent-token-stepup";
export const AGENT_TOKEN_STEPUP_TTL_MS = 5 * 60 * 1000;

export type AgentTokenStepUpAction =
  | "issue_agent_token"
  | "revoke_agent_token"
  | "create_agent";

export interface AgentTokenStepUpBinding {
  challengeId: string;
  action: AgentTokenStepUpAction;
  agentId?: string;
  tokenId?: string;
}

/**
 * 无迁移前提下：webauthn_challenges 无法存 agent_id / 新 purpose。
 * 用 SESSION_SECRET 签发短时绑定，把 challenge_id + 动作 + 目标绑在一起。
 * 挑战行本身用 purpose=login 抢占（与 invite 相同；见 PR「后续建议」）。
 */
function secretKey(): Uint8Array {
  return new TextEncoder().encode(getSessionSecret());
}

export async function createAgentTokenStepUpBinding(
  input: AgentTokenStepUpBinding,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const claims: Record<string, string> = {
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
    .sign(secretKey());
}

export async function verifyAgentTokenStepUpBinding(
  token: string,
  expected: AgentTokenStepUpBinding,
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: ["HS256"],
      audience: AGENT_TOKEN_STEPUP_AUD,
      currentDate: now,
    });
    if (
      payload.sub !== "owner" ||
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
