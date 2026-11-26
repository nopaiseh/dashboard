import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticateAgentToken,
  extractBearerToken,
  type AuthenticatedAgent,
} from "@/lib/agent-auth";
import { hashAgentToken } from "@/lib/crypto";
import { checkRateLimit } from "@/lib/rate-limit";

const AGENT_RATE_LIMIT = 60;
const AGENT_RATE_WINDOW_MS = 60_000;

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
  const rate = checkRateLimit(
    `agent:${tokenHash}`,
    AGENT_RATE_LIMIT,
    AGENT_RATE_WINDOW_MS,
  );
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
