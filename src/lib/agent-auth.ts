import { hashAgentToken, verifyAgentToken } from "@/lib/crypto";
import { AGENT_FORBIDDEN_STATUSES, type ItemStatus } from "@/lib/types";

export interface TokenRecord {
  agent_id: string;
  token_hash: string;
  revoked_at: string | null;
}

export interface AuthenticatedAgent {
  agentId: string;
  tokenHash: string;
}

/**
 * 从 Authorization: Bearer <token> 解析原始令牌。
 */
export function extractBearerToken(
  authorizationHeader: string | null,
): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match) {
    return null;
  }
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * 在候选令牌记录中校验哈希且未作废。
 * 调用方应先用 hash 查库；此函数负责比对与作废检查。
 */
export function authenticateAgentToken(
  rawToken: string,
  records: TokenRecord[],
): AuthenticatedAgent | null {
  const presentedHash = hashAgentToken(rawToken);
  for (const record of records) {
    if (record.revoked_at) {
      continue;
    }
    if (verifyAgentToken(rawToken, record.token_hash)) {
      return { agentId: record.agent_id, tokenHash: presentedHash };
    }
  }
  return null;
}

/** 姐妹不可将状态写成 approved / rejected。 */
export function assertAgentMaySetStatus(
  status: ItemStatus | undefined,
): { ok: true } | { ok: false; error: string } {
  if (status === undefined) {
    return { ok: true };
  }
  if (AGENT_FORBIDDEN_STATUSES.has(status)) {
    return {
      ok: false,
      error: "agents cannot set status to approved or rejected",
    };
  }
  return { ok: true };
}

/** 只能改自己名下的事项。 */
export function assertAgentOwnsItem(
  agentId: string,
  itemAgentId: string,
): { ok: true } | { ok: false; error: string } {
  if (agentId !== itemAgentId) {
    return { ok: false, error: "forbidden: item belongs to another agent" };
  }
  return { ok: true };
}
