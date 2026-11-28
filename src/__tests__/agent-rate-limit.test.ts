import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateAgentBearerToken, hashAgentToken } from "@/lib/crypto";
import { resetRateLimits } from "@/lib/rate-limit";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type RpcCall = { name: string; args: Record<string, unknown> };

function mockSupabase(options: {
  rpcImpl: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  tokenRow?: {
    agent_id: string;
    token_hash: string;
    revoked_at: string | null;
  } | null;
}) {
  const rpcCalls: RpcCall[] = [];
  const rpc = vi.fn(
    async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return options.rpcImpl(name, args);
    },
  );

  const supabase = {
    rpc,
    from: (table: string) => {
      if (table !== "agent_tokens") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: options.tokenRow === undefined ? null : options.tokenRow,
              error: null,
            }),
          }),
        }),
      };
    },
  };

  return { supabase, rpc, rpcCalls };
}

describe("resolveAgentFromRequest DB rate limit", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRateLimits();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("allows when minute and day RPCs allow", async () => {
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    const { supabase, rpcCalls } = mockSupabase({
      rpcImpl: async () => ({
        data: { allowed: true, remaining: 59, retry_after_seconds: 60 },
        error: null,
      }),
      tokenRow: {
        agent_id: AGENT_ID,
        token_hash: tokenHash,
        revoked_at: null,
      },
    });

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");
    const result = await resolveAgentFromRequest(
      supabase as never,
      `Bearer ${raw}`,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agent.agentId).toBe(AGENT_ID);
    }
    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls[0]?.name).toBe("rate_limit_check");
    expect(rpcCalls[0]?.args).toEqual({
      p_key: `agent:${tokenHash}`,
      p_limit: 60,
      p_window_seconds: 60,
    });
    expect(rpcCalls[1]?.args).toEqual({
      p_key: `agent:${tokenHash}`,
      p_limit: 1000,
      p_window_seconds: 86_400,
    });
  });

  it("returns 429 with retry when minute limit is hit", async () => {
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    const { supabase, rpcCalls } = mockSupabase({
      rpcImpl: async (_name, args) => {
        if (args.p_window_seconds === 60) {
          return {
            data: {
              allowed: false,
              remaining: 0,
              retry_after_seconds: 42,
            },
            error: null,
          };
        }
        throw new Error("day rpc should not run after minute deny");
      },
      tokenRow: {
        agent_id: AGENT_ID,
        token_hash: tokenHash,
        revoked_at: null,
      },
    });

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");
    const result = await resolveAgentFromRequest(
      supabase as never,
      `Bearer ${raw}`,
    );

    expect(result).toEqual({
      ok: false,
      status: 429,
      error: "rate limit exceeded",
      retryAfterSeconds: 42,
    });
    expect(rpcCalls).toHaveLength(1);
  });

  it("returns 429 when day limit is hit after minute allows", async () => {
    const raw = generateAgentBearerToken();
    const { supabase } = mockSupabase({
      rpcImpl: async (_name, args) => {
        if (args.p_window_seconds === 60) {
          return {
            data: { allowed: true, remaining: 10, retry_after_seconds: 60 },
            error: null,
          };
        }
        return {
          data: {
            allowed: false,
            remaining: 0,
            retry_after_seconds: 3600,
          },
          error: null,
        };
      },
    });

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");
    const result = await resolveAgentFromRequest(
      supabase as never,
      `Bearer ${raw}`,
    );

    expect(result).toEqual({
      ok: false,
      status: 429,
      error: "rate limit exceeded",
      retryAfterSeconds: 3600,
    });
  });

  it("falls back to in-memory limiter when RPC errors", async () => {
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    let rpcCalls = 0;
    const { supabase } = mockSupabase({
      rpcImpl: async () => {
        rpcCalls += 1;
        return { data: null, error: { message: "db down" } };
      },
      tokenRow: {
        agent_id: AGENT_ID,
        token_hash: tokenHash,
        revoked_at: null,
      },
    });

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");

    for (let i = 0; i < 60; i += 1) {
      const ok = await resolveAgentFromRequest(
        supabase as never,
        `Bearer ${raw}`,
      );
      expect(ok.ok).toBe(true);
    }

    const limited = await resolveAgentFromRequest(
      supabase as never,
      `Bearer ${raw}`,
    );
    expect(limited).toMatchObject({
      ok: false,
      status: 429,
      error: "rate limit exceeded",
    });
    if (!limited.ok) {
      expect(limited.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    }
    expect(rpcCalls).toBe(61);
    expect(console.warn).toHaveBeenCalled();
  });

  it("never passes the raw token to rate_limit_check args", async () => {
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    const { supabase, rpcCalls } = mockSupabase({
      rpcImpl: async () => ({
        data: { allowed: true, remaining: 1, retry_after_seconds: 60 },
        error: null,
      }),
      tokenRow: {
        agent_id: AGENT_ID,
        token_hash: tokenHash,
        revoked_at: null,
      },
    });

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");
    await resolveAgentFromRequest(supabase as never, `Bearer ${raw}`);

    for (const call of rpcCalls) {
      const serialized = JSON.stringify(call.args);
      expect(serialized).not.toContain(raw);
      expect(call.args.p_key).toBe(`agent:${tokenHash}`);
    }
  });
});

describe("jsonError Retry-After on 429", () => {
  it("sets Retry-After when retryAfterSeconds is provided", async () => {
    const { jsonError } = await import("@/lib/http");
    const res = jsonError(429, "rate limit exceeded", {
      retryAfterSeconds: 17,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    const body = await res.json();
    expect(body.retryAfterSeconds).toBe(17);
  });
});
