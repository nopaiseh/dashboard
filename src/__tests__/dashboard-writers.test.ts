/**
 * Owner dashboard writers API + agent write gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillDashboardWriters } from "@/lib/dashboard/writers";

const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHALLENGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CRED_ID = "cred-test";

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("backfillDashboardWriters", () => {
  it("assigns unique owners and maps bank to cpf writer", () => {
    expect(
      backfillDashboardWriters([
        { category: "CPF", agent_id: AGENT_A },
        { category: "travel", agent_id: AGENT_B },
        { category: "bank", agent_id: AGENT_B },
      ]),
    ).toEqual([
      { category: "bank", writer_agent_id: AGENT_A },
      { category: "cpf", writer_agent_id: AGENT_A },
      { category: "travel", writer_agent_id: AGENT_B },
    ]);
  });

  it("skips multi-owner categories", () => {
    expect(
      backfillDashboardWriters([
        { category: "travel", agent_id: AGENT_A },
        { category: "travel", agent_id: AGENT_B },
      ]),
    ).toEqual([]);
  });
});

describe("owner dashboard writers API", () => {
  it("GET requires session", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: false, status: 401, error: "unauthorized" }),
    }));
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));

    const { GET } = await import("@/app/api/owner/dashboard/writers/route");
    const res = await GET(
      new Request("https://desk.nopaiseh.com/api/owner/dashboard/writers", {
        headers: { origin: "https://desk.nopaiseh.com" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("PUT sets writer with session + step-up", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/passkey-step-up", () => ({
      consumePasskeyAssertion: async () => ({
        ok: true,
        credentialId: CRED_ID,
      }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "agents") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: AGENT_A },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "dashboard_writers") {
            return {
              upsert: () => ({
                select: () => ({
                  single: async () => ({
                    data: {
                      category: "bank",
                      writer_agent_id: AGENT_A,
                      updated_at: "2026-11-28T00:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          throw new Error(table);
        },
      }),
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "set_dashboard_writer",
      agentId: AGENT_A,
      category: "bank",
    });

    const { PUT } = await import("@/app/api/owner/dashboard/writers/route");
    const res = await PUT(
      new Request("https://desk.nopaiseh.com/api/owner/dashboard/writers", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
          category: "Bank",
          writer_agent_id: AGENT_A,
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      writer: { category: string; writer_agent_id: string };
    };
    expect(body.writer).toEqual({
      category: "bank",
      writer_agent_id: AGENT_A,
      updated_at: "2026-11-28T00:00:00.000Z",
    });
  });

  it("agent bearer cannot call owner writers API", async () => {
    vi.doMock("@/lib/origin", () => ({
      assertSameOrigin: () => ({ ok: true }),
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({
        ok: false,
        status: 401,
        error: "unauthorized",
      }),
    }));
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));

    const { PUT } = await import("@/app/api/owner/dashboard/writers/route");
    const res = await PUT(
      new Request("https://desk.nopaiseh.com/api/owner/dashboard/writers", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
          authorization: "Bearer xjg_at_fake",
        },
        body: JSON.stringify({
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding: "x",
          category: "bank",
          writer_agent_id: AGENT_B,
        }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
