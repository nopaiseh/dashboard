import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateAgentToken,
  extractBearerToken,
  type AuthenticatedAgent,
} from "@/lib/agent-auth";
import { hashAgentToken } from "@/lib/crypto";
import { checkRateLimit, type RateLimitResult } from "@/lib/rate-limit";

const AGENT_RATE_LIMIT_PER_MINUTE = 60;
const AGENT_RATE_WINDOW_SECONDS = 60;
const AGENT_RATE_LIMIT_PER_DAY = 1000;
const AGENT_RATE_DAY_WINDOW_SECONDS = 86_400;
/** Shared bucket for unknown / revoked / otherwise invalid bearer tokens. */
const AGENT_INVALID_RATE_KEY = "agent:invalid";
const AGENT_RATE_RPC_TIMEOUT_MS = 1500;

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

/**
 * Cross-instance limiter via `rate_limit_check`.
 * On RPC failure or timeout, falls back to the in-process Map (never fail-open).
 */
async function checkAgentRateLimit(
  supabase: SupabaseClient,
  key: string,
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

  const minute = await runRpc(
    AGENT_RATE_LIMIT_PER_MINUTE,
    AGENT_RATE_WINDOW_SECONDS,
  );
  if (minute === "error") {
    console.warn(
      "agent rate limit rpc unavailable; falling back to in-process limiter",
    );
    return fallbackInProcess(key);
  }
  if (!minute.allowed) {
    return minute;
  }

  const day = await runRpc(
    AGENT_RATE_LIMIT_PER_DAY,
    AGENT_RATE_DAY_WINDOW_SECONDS,
  );
  if (day === "error") {
    console.warn(
      "agent rate limit rpc unavailable; falling back to in-process limiter",
    );
    return fallbackInProcess(key);
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

  // One token-table lookup before rate limiting (avoids per-hash bucket explosion
  // from invalid / scanned tokens).
  const { data, error } = await supabase
    .from("agent_tokens")
    .select("agent_id, token_hash, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "token lookup failed" };
  }

  const agent = data ? authenticateAgentToken(raw, [data]) : null;
  const rateKey = agent
    ? `agent:${tokenHash}`
    : AGENT_INVALID_RATE_KEY;

  const rate = await checkAgentRateLimit(supabase, rateKey);
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      error: "rate limit exceeded",
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  if (!agent) {
    return {
      ok: false,
      status: 401,
      error: data ? "invalid or revoked token" : "invalid token",
    };
  }

  return { ok: true, agent };
}
