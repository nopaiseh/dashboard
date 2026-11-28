import { hashAgentToken, verifyAgentToken } from "@/lib/crypto";
import {
  AGENT_ALLOWED_STATUSES,
  type ItemKind,
  type ItemStatus,
} from "@/lib/types";

export interface TokenRecord {
  agent_id: string;
  token_hash: string;
  revoked_at: string | null;
  /** Normalized lowercase category allow-list; empty → no dashboard writes. */
  allowed_categories?: string[] | null;
}

export interface AuthenticatedAgent {
  agentId: string;
  tokenHash: string;
  /** Normalized lowercase; empty array denies all dashboard category writes. */
  allowedCategories: string[];
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

function normalizeAllowedCategories(
  raw: string[] | null | undefined,
): string[] {
  if (!raw || raw.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (typeof c !== "string") continue;
    const n = c.trim().toLowerCase();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
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
      return {
        agentId: record.agent_id,
        tokenHash: presentedHash,
        allowedCategories: normalizeAllowedCategories(
          record.allowed_categories,
        ),
      };
    }
  }
  return null;
}

/**
 * 姐妹可设状态：done / withdrawn。
 * 审批类（approval）且仍为 open 时，只能 withdrawn，不能 done。
 */
export function assertAgentMaySetStatus(
  status: ItemStatus | undefined,
  kind?: ItemKind,
  currentStatus?: ItemStatus,
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
  if (
    kind === "approval" &&
    currentStatus === "open" &&
    status === "done"
  ) {
    return {
      ok: false,
      error: "open approval items may only be withdrawn, not done",
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
