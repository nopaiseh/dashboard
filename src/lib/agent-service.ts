import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateAgentToken,
  extractBearerToken,
  type AuthenticatedAgent,
} from "@/lib/agent-auth";
import { hashAgentToken } from "@/lib/crypto";
import {
  checkRateLimit,
  peekRateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit";

/** Shared with DB `rate_limit_check` and the in-process invalid precheck. */
export const AGENT_RATE_LIMIT_PER_MINUTE = 60;
export const AGENT_RATE_WINDOW_SECONDS = 60;
export const AGENT_RATE_LIMIT_PER_DAY = 1000;
export const AGENT_RATE_DAY_WINDOW_SECONDS = 86_400;
/** Shared bucket for unknown / revoked / otherwise invalid bearer tokens. */
export const AGENT_INVALID_RATE_KEY = "agent:invalid";

const AGENT_RATE_RPC_TIMEOUT_MS = 1500;

/** In-process set of token hashes recently validated on this instance. */
export const RECENTLY_VALID_MAX = 100;
export const RECENTLY_VALID_TTL_MS = 10 * 60 * 1000;

/** hash → expiresAt; Map insertion order used as LRU. */
const recentlyValidHashes = new Map<string, number>();

type DbRateLimitRow = {
  allowed?: boolean;
  remaining?: number;
  retry_after_seconds?: number;
};

function parseDbRateLimit(data: unknown): RateLimitResult | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const row = data as DbRateLimitRow;
  if (typeof row.allowed !== "boolean") {
    return null;
  }
  return {
    allowed: row.allowed,
    remaining:
      typeof row.remaining === "number" && Number.isFinite(row.remaining)
        ? Math.max(0, row.remaining)
        : 0,
    retryAfterSeconds:
      typeof row.retry_after_seconds === "number" &&
      Number.isFinite(row.retry_after_seconds)
        ? Math.max(1, Math.ceil(row.retry_after_seconds))
        : AGENT_RATE_WINDOW_SECONDS,
  };
}

function fallbackInProcess(key: string): RateLimitResult {
  return checkRateLimit(
    key,
    AGENT_RATE_LIMIT_PER_MINUTE,
    AGENT_RATE_WINDOW_SECONDS * 1000,
  );
}

function peekInvalidMemory(now: number = Date.now()): RateLimitResult {
  return peekRateLimit(
    AGENT_INVALID_RATE_KEY,
    AGENT_RATE_LIMIT_PER_MINUTE,
    AGENT_RATE_WINDOW_SECONDS * 1000,
    now,
  );
}

function bumpInvalidMemory(now: number = Date.now()): RateLimitResult {
  return checkRateLimit(
    AGENT_INVALID_RATE_KEY,
    AGENT_RATE_LIMIT_PER_MINUTE,
    AGENT_RATE_WINDOW_SECONDS * 1000,
    now,
  );
}

function pruneRecentlyValid(now: number): void {
  for (const [hash, expiresAt] of recentlyValidHashes) {
    if (expiresAt <= now) {
      recentlyValidHashes.delete(hash);
    }
  }
}

function isRecentlyValidHash(tokenHash: string, now: number = Date.now()): boolean {
  const expiresAt = recentlyValidHashes.get(tokenHash);
  if (expiresAt === undefined) {
    return false;
  }
  if (expiresAt <= now) {
    recentlyValidHashes.delete(tokenHash);
    return false;
  }
  // Touch LRU order without extending TTL.
  recentlyValidHashes.delete(tokenHash);
  recentlyValidHashes.set(tokenHash, expiresAt);
  return true;
}

function rememberRecentlyValidHash(
  tokenHash: string,
  now: number = Date.now(),
): void {
  pruneRecentlyValid(now);
  recentlyValidHashes.delete(tokenHash);
  recentlyValidHashes.set(tokenHash, now + RECENTLY_VALID_TTL_MS);
  while (recentlyValidHashes.size > RECENTLY_VALID_MAX) {
    const oldest = recentlyValidHashes.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    recentlyValidHashes.delete(oldest);
  }
}

function forgetRecentlyValidHash(tokenHash: string): void {
  recentlyValidHashes.delete(tokenHash);
}

/** 测试用：清空本实例 recently-valid 哈希集。 */
export function resetRecentlyValidAgentHashes(): void {
  recentlyValidHashes.clear();
}

/** 测试用：当前集大小（含未过期条目；调用方可用 fake timers）。 */
export function recentlyValidAgentHashCount(): number {
  return recentlyValidHashes.size;
}

/**
 * Cross-instance limiter via `rate_limit_check`.
 * On RPC failure or timeout, falls back to the in-process Map (never fail-open),
 * unless `memoryFallback` is provided (used when the invalid bucket was already bumped).
 */
async function checkAgentRateLimit(
  supabase: SupabaseClient,
  key: string,
  memoryFallback?: RateLimitResult,
): Promise<RateLimitResult> {
  const runRpc = async (
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult | "error"> => {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), AGENT_RATE_RPC_TIMEOUT_MS);
    try {
      const { data, error } = await supabase
        .rpc("rate_limit_check", {
          p_key: key,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        })
        .abortSignal(ac.signal);
      if (error) {
        return "error";
      }
      return parseDbRateLimit(data) ?? "error";
    } catch {
      return "error";
    } finally {
      clearTimeout(timer);
    }
  };

  const fallbackOrMemory = (): RateLimitResult => {
    console.warn(
      "agent rate limit rpc unavailable; falling back to in-process limiter",
    );
    return memoryFallback ?? fallbackInProcess(key);
  };

  const minute = await runRpc(
    AGENT_RATE_LIMIT_PER_MINUTE,
    AGENT_RATE_WINDOW_SECONDS,
  );
  if (minute === "error") {
    return fallbackOrMemory();
  }
  if (!minute.allowed) {
    return minute;
  }

  const day = await runRpc(
    AGENT_RATE_LIMIT_PER_DAY,
    AGENT_RATE_DAY_WINDOW_SECONDS,
  );
  if (day === "error") {
    return fallbackOrMemory();
  }
  if (!day.allowed) {
    return day;
  }

  return {
    allowed: true,
    remaining: Math.min(minute.remaining, day.remaining),
    retryAfterSeconds: minute.retryAfterSeconds,
  };
}

export async function resolveAgentFromRequest(
  supabase: SupabaseClient,
  authorizationHeader: string | null,
): Promise<
  | { ok: true; agent: AuthenticatedAgent }
  | { ok: false; status: number; error: string; retryAfterSeconds?: number }
> {
  const raw = extractBearerToken(authorizationHeader);
  if (!raw) {
    return { ok: false, status: 401, error: "missing bearer token" };
  }

  const tokenHash = hashAgentToken(raw);
  const now = Date.now();

  // In-process precheck: avoid agent_tokens + RPC when the local invalid
  // bucket is already exhausted. Recently-validated hashes on this instance
  // skip only this precheck (lookup / revoke / per-token limits still run).
  if (!isRecentlyValidHash(tokenHash, now)) {
    const peeked = peekInvalidMemory(now);
    if (!peeked.allowed) {
      return {
        ok: false,
        status: 429,
        error: "rate limit exceeded",
        retryAfterSeconds: peeked.retryAfterSeconds,
      };
    }
  }

  // One token-table lookup before rate limiting (avoids per-hash bucket explosion
  // from invalid / scanned tokens).
  const { data, error } = await supabase
    .from("agent_tokens")
    .select("agent_id, token_hash, revoked_at, allowed_categories")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "token lookup failed" };
  }

  const agent = data ? authenticateAgentToken(raw, [data]) : null;

  if (!agent) {
    forgetRecentlyValidHash(tokenHash);
    // Always bump the local invalid bucket (feeds the next request's precheck),
    // in addition to the DB RPC. Pass the bump result as RPC fallback so we
    // do not double-increment the same in-process key.
    const memoryRate = bumpInvalidMemory(now);
    const rate = await checkAgentRateLimit(
      supabase,
      AGENT_INVALID_RATE_KEY,
      memoryRate,
    );
    if (!rate.allowed) {
      return {
        ok: false,
        status: 429,
        error: "rate limit exceeded",
        retryAfterSeconds: rate.retryAfterSeconds,
      };
    }
    return {
      ok: false,
      status: 401,
      error: data ? "invalid or revoked token" : "invalid token",
    };
  }

  rememberRecentlyValidHash(tokenHash, now);

  const rate = await checkAgentRateLimit(supabase, `agent:${tokenHash}`);
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      error: "rate limit exceeded",
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  return { ok: true, agent };
}
