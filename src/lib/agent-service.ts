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

/**
 * Cross-instance limiter via `rate_limit_check`.
 * On RPC failure, falls back to the in-process Map (never fail-open).
 */
async function checkAgentTokenRateLimit(
  supabase: SupabaseClient,
  tokenHash: string,
): Promise<RateLimitResult> {
  const key = `agent:${tokenHash}`;

  const runRpc = async (
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult | "error"> => {
    const { data, error } = await supabase.rpc("rate_limit_check", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      return "error";
    }
    return parseDbRateLimit(data) ?? "error";
  };

  const minute = await runRpc(
    AGENT_RATE_LIMIT_PER_MINUTE,
    AGENT_RATE_WINDOW_SECONDS,
  );
  if (minute === "error") {
    console.warn(
      "agent rate limit rpc unavailable; falling back to in-process limiter",
    );
    return checkRateLimit(
      key,
      AGENT_RATE_LIMIT_PER_MINUTE,
      AGENT_RATE_WINDOW_SECONDS * 1000,
    );
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
    return checkRateLimit(
      key,
      AGENT_RATE_LIMIT_PER_MINUTE,
      AGENT_RATE_WINDOW_SECONDS * 1000,
    );
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
  const rate = await checkAgentTokenRateLimit(supabase, tokenHash);
  if (!rate.allowed) {
    return {
      ok: false,
      status: 429,
      error: "rate limit exceeded",
      retryAfterSeconds: rate.retryAfterSeconds,
    };
  }

  const { data, error } = await supabase
    .from("agent_tokens")
    .select("agent_id, token_hash, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: "token lookup failed" };
  }
  if (!data) {
    return { ok: false, status: 401, error: "invalid token" };
  }

  const agent = authenticateAgentToken(raw, [data]);
  if (!agent) {
    return { ok: false, status: 401, error: "invalid or revoked token" };
  }

  return { ok: true, agent };
}
