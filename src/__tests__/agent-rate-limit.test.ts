import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateAgentBearerToken, hashAgentToken } from "@/lib/crypto";
import { checkRateLimit, resetRateLimits } from "@/lib/rate-limit";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type RpcCall = { name: string; args: Record<string, unknown> };

type RpcResult = { data: unknown; error: unknown };

/** Thenable that mirrors supabase-js `.rpc(...).abortSignal(...)`. */
function asRpcBuilder(
  result: Promise<RpcResult> | RpcResult,
): {
  abortSignal: (signal: AbortSignal) => Promise<RpcResult>;
  then: Promise<RpcResult>["then"];
} {
  const promise = Promise.resolve(result);
  return {
    abortSignal(signal: AbortSignal) {
      return new Promise<RpcResult>((resolve, reject) => {
        if (signal.aborted) {
          resolve({
            data: null,
            error: { message: "AbortError: The user aborted a request." },
          });
          return;
        }
        const onAbort = () => {
          resolve({
            data: null,
            error: { message: "AbortError: The user aborted a request." },
          });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
          (value) => {
            signal.removeEventListener("abort", onAbort);
            resolve(value);
          },
          (err) => {
            signal.removeEventListener("abort", onAbort);
            reject(err);
          },
        );
      });
    },
    then: promise.then.bind(promise),
  };
}

function mockSupabase(options: {
  rpcImpl: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<RpcResult> | RpcResult;
  tokenRow?: {
    agent_id: string;
    token_hash: string;
    revoked_at: string | null;
  } | null;
  tokenLookupError?: unknown;
  trackLookups?: { count: number };
}) {
  const rpcCalls: RpcCall[] = [];
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return asRpcBuilder(options.rpcImpl(name, args));
  });

  const supabase = {
    rpc,
    from: (table: string) => {
      if (table !== "agent_tokens") {
        throw new Error(`unexpected table ${table}`);
      }
      if (options.trackLookups) {
        options.trackLookups.count += 1;
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data:
                options.tokenLookupError !== undefined
                  ? null
                  : options.tokenRow === undefined
                    ? null
                    : options.tokenRow,
              error: options.tokenLookupError ?? null,
            }),
          }),
        }),
      };
    },
  };

  return { supabase, rpc, rpcCalls };
}

/** In-memory windowed counter driven by Date.now() for fake-timer DB mocks. */
function createWindowedRpcMock() {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return async (
    _name: string,
    args: Record<string, unknown>,
  ): Promise<RpcResult> => {
    const key = String(args.p_key);
    const limit = Number(args.p_limit);
    const windowMs = Number(args.p_window_seconds) * 1000;
    const bucketId = `${key}|${windowMs}`;
    const now = Date.now();
    const existing = buckets.get(bucketId);
    if (!existing || existing.resetAt <= now) {
      buckets.set(bucketId, { count: 1, resetAt: now + windowMs });
      return {
        data: {
          allowed: true,
          remaining: limit - 1,
          retry_after_seconds: Math.ceil(windowMs / 1000),
        },
        error: null,
      };
    }
    if (existing.count >= limit) {
      return {
        data: {
          allowed: false,
          remaining: 0,
          retry_after_seconds: Math.max(
            1,
            Math.ceil((existing.resetAt - now) / 1000),
          ),
        },
        error: null,
      };
    }
    existing.count += 1;
    return {
      data: {
        allowed: true,
        remaining: limit - existing.count,
        retry_after_seconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000),
        ),
      },
      error: null,
    };
  };
}

describe("resolveAgentFromRequest DB rate limit", () => {
  beforeEach(() => {
    vi.resetModules();
    resetRateLimits();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("allows when minute and day RPCs allow", async () => {
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    const lookups = { count: 0 };
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
      trackLookups: lookups,
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
    expect(lookups.count).toBe(1);
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
    const tokenHash = hashAgentToken(raw);
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
      retryAfterSeconds: 3600,
    });
  });

  it("uses agent:invalid for unknown tokens and returns 401 under the limit", async () => {
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    const { supabase, rpcCalls } = mockSupabase({
      rpcImpl: async () => ({
        data: { allowed: true, remaining: 59, retry_after_seconds: 60 },
        error: null,
      }),
      tokenRow: null,
    });

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");
    const result = await resolveAgentFromRequest(
      supabase as never,
      `Bearer ${raw}`,
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "invalid token",
    });
    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const call of rpcCalls) {
      expect(call.args.p_key).toBe("agent:invalid");
      expect(call.args.p_key).not.toBe(`agent:${tokenHash}`);
    }
  });

  it("uses agent:invalid for revoked tokens (never per-hash key)", async () => {
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    const { supabase, rpcCalls } = mockSupabase({
      rpcImpl: async () => ({
        data: { allowed: true, remaining: 58, retry_after_seconds: 60 },
        error: null,
      }),
      tokenRow: {
        agent_id: AGENT_ID,
        token_hash: tokenHash,
        revoked_at: "2026-01-01T00:00:00.000Z",
      },
    });

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");
    const result = await resolveAgentFromRequest(
      supabase as never,
      `Bearer ${raw}`,
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "invalid or revoked token",
    });
    expect(rpcCalls.every((c) => c.args.p_key === "agent:invalid")).toBe(true);
    expect(
      rpcCalls.some((c) => c.args.p_key === `agent:${tokenHash}`),
    ).toBe(false);
  });

  it("returns 429 when invalid tokens exceed the shared limit", async () => {
    const raw = generateAgentBearerToken();
    const { supabase, rpcCalls } = mockSupabase({
      rpcImpl: async () => ({
        data: {
          allowed: false,
          remaining: 0,
          retry_after_seconds: 30,
        },
        error: null,
      }),
      tokenRow: null,
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
      retryAfterSeconds: 30,
    });
    expect(rpcCalls[0]?.args.p_key).toBe("agent:invalid");
  });

  it("missing bearer returns 401 without touching the DB", async () => {
    const from = vi.fn();
    const rpc = vi.fn();
    const supabase = { from, rpc };

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");
    const result = await resolveAgentFromRequest(
      supabase as never,
      null,
    );

    expect(result).toEqual({
      ok: false,
      status: 401,
      error: "missing bearer token",
    });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
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

  it("falls back to in-memory limiter when RPC times out", async () => {
    vi.useFakeTimers();
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    let hang = true;
    const { supabase } = mockSupabase({
      rpcImpl: () =>
        hang
          ? new Promise<RpcResult>(() => {
              /* never resolves — AbortController timer aborts */
            })
          : { data: null, error: { message: "db down" } },
      tokenRow: {
        agent_id: AGENT_ID,
        token_hash: tokenHash,
        revoked_at: null,
      },
    });

    const { resolveAgentFromRequest } = await import("@/lib/agent-service");

    const pending = resolveAgentFromRequest(
      supabase as never,
      `Bearer ${raw}`,
    );
    await vi.advanceTimersByTimeAsync(1500);
    const result = await pending;

    expect(result.ok).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("falling back to in-process limiter"),
    );

    // Avoid advancing the 60s window: further RPC failures resolve immediately.
    hang = false;
    for (let i = 0; i < 59; i += 1) {
      expect(
        (await resolveAgentFromRequest(supabase as never, `Bearer ${raw}`)).ok,
      ).toBe(true);
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

  it("in-memory limiter count resets after the window", () => {
    vi.useFakeTimers();
    const key = "agent:window-reset";
    for (let i = 0; i < 60; i += 1) {
      expect(checkRateLimit(key, 60, 60_000).allowed).toBe(true);
    }
    expect(checkRateLimit(key, 60, 60_000).allowed).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(checkRateLimit(key, 60, 60_000).allowed).toBe(true);
  });

  it("mocked DB path count resets after the window with fake timers", async () => {
    vi.useFakeTimers();
    const raw = generateAgentBearerToken();
    const tokenHash = hashAgentToken(raw);
    const { supabase } = mockSupabase({
      rpcImpl: createWindowedRpcMock(),
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
    expect(limited).toMatchObject({ ok: false, status: 429 });

    vi.advanceTimersByTime(60_000);
    const after = await resolveAgentFromRequest(
      supabase as never,
      `Bearer ${raw}`,
    );
    expect(after.ok).toBe(true);
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
