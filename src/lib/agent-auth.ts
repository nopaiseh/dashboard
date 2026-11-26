import { hashAgentToken, verifyAgentToken } from "@/lib/crypto";
import { AGENT_ALLOWED_STATUSES, type ItemStatus } from "@/lib/types";

export interface TokenRecord {
  agent_id: string;
  token_hash: string;
  revoked_at: string | null;
}

export interface AuthenticatedAgent {
  agentId: string;
  tokenHash: string;
}

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

/** 姐妹可设状态仅 done / withdrawn。 */
export function assertAgentMaySetStatus(
  status: ItemStatus | undefined,
): { ok: true } | { ok: false; error: string } {
  if (status === undefined) {
    return { ok: true };
  }
  if (!AGENT_ALLOWED_STATUSES.has(status)) {
    return {
      ok: false,
      error: "agents may only set status to done or withdrawn",
    };
  }
  return { ok: true };
}

export function assertAgentOwnsItem(
  agentId: string,
  itemAgentId: string,
): { ok: true } | { ok: false; error: string } {
  if (agentId !== itemAgentId) {
    return { ok: false, error: "forbidden: item belongs to another agent" };
  }
  return { ok: true };
}
