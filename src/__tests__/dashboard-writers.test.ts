/**
 * Owner dashboard writers API (many-to-many) + backfill + write gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backfillDashboardWriters } from "@/lib/dashboard/writers";
import { mockDashboardWritersFrom } from "./helpers/dashboard-writer-mock";

const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CHALLENGE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CRED_ID = "cred-test";
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const KEY_V1 = Buffer.alloc(32, 1).toString("base64");

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
  process.env.FIELD_ENCRYPTION_KEY = KEY_V1;
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("backfillDashboardWriters (many-to-many)", () => {
  it("adds every section owner; bank inherits all cpf writers", () => {
    expect(
      backfillDashboardWriters([
        { category: "CPF", agent_id: AGENT_A },
        { category: "cpf", agent_id: AGENT_B },
        { category: "travel", agent_id: AGENT_B },
        { category: "bank", agent_id: AGENT_B },
      ]),
    ).toEqual([
      { category: "bank", agent_id: AGENT_A },
      { category: "bank", agent_id: AGENT_B },
      { category: "cpf", agent_id: AGENT_A },
      { category: "cpf", agent_id: AGENT_B },
      { category: "travel", agent_id: AGENT_B },
    ]);
  });
});

describe("two writers may both write; remove → 403", () => {
  it("both listed agents can POST sections; removed agent is denied", async () => {
    for (const [agentId, writers, expected] of [
      [AGENT_A, { bank: [AGENT_A, AGENT_B] }, 201],
      [AGENT_B, { bank: [AGENT_A, AGENT_B] }, 201],
      [AGENT_B, { bank: [AGENT_A] }, 403],
      [AGENT_A, {}, 403],
    ] as const) {
      vi.resetModules();
      process.env.FIELD_ENCRYPTION_KEY = KEY_V1;
      vi.doMock("@/lib/require-request", () => ({
        requireRequest: async () => undefined,
      }));
      vi.doMock("@/lib/agent-service", () => ({
        resolveAgentFromRequest: async () => ({
          ok: true,
          agent: { agentId, tokenHash: "hash" },
        }),
      }));
      vi.doMock("@/lib/supabase/server", () => ({
        getServiceClient: () => ({
          from: (table: string) => {
            if (table === "dashboard_writers") {
              return mockDashboardWritersFrom(writers);
            }
            if (table === "dashboard_sections") {
              return {
                insert: () => ({
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: SECTION_ID,
                        category: "bank",
                        sort_order: 0,
                        agent_id: agentId,
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
      const { POST } = await import("@/app/api/agent/dashboard/sections/route");
      const res = await POST(
        new Request("http://localhost/api/agent/dashboard/sections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ category: "bank" }),
        }),
      );
      expect(res.status, String(agentId)).toBe(expected);
    }
  });
});

describe("owner dashboard writers API", () => {
  it("GET requires session", async () => {
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

    const { GET } = await import("@/app/api/owner/dashboard/writers/route");
    const res = await GET(
      new Request("https://desk.nopaiseh.com/api/owner/dashboard/writers", {
        headers: { origin: "https://desk.nopaiseh.com" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST adds writer with session + step-up", async () => {
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
                  maybeSingle: async () => ({
                    data: {
                      category: "bank",
                      agent_id: AGENT_A,
                      created_at: "2026-11-28T00:00:00.000Z",
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
      action: "add_dashboard_writer",
      agentId: AGENT_A,
      category: "bank",
    });

    const { POST } = await import("@/app/api/owner/dashboard/writers/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/owner/dashboard/writers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
          category: "Bank",
          agent_id: AGENT_A,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      writer: { category: string; agent_id: string };
    };
    expect(body.writer).toEqual({
      category: "bank",
      agent_id: AGENT_A,
      created_at: "2026-11-28T00:00:00.000Z",
    });
  });

  it("DELETE removes writer with step-up", async () => {
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
        from: () => ({
          delete: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: { category: "bank", agent_id: AGENT_B },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    }));

    const { createAgentTokenStepUpBinding } = await import(
      "@/lib/agent-token-stepup"
    );
    const binding = await createAgentTokenStepUpBinding({
      challengeId: CHALLENGE_ID,
      action: "remove_dashboard_writer",
      agentId: AGENT_B,
      category: "bank",
    });

    const { DELETE } = await import("@/app/api/owner/dashboard/writers/route");
    const res = await DELETE(
      new Request("https://desk.nopaiseh.com/api/owner/dashboard/writers", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          origin: "https://desk.nopaiseh.com",
        },
        body: JSON.stringify({
          challenge_id: CHALLENGE_ID,
          assertion: { id: CRED_ID },
          binding,
          category: "bank",
          agent_id: AGENT_B,
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      removed: { category: "bank", agent_id: AGENT_B },
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

    const { POST } = await import("@/app/api/owner/dashboard/writers/route");
    const res = await POST(
      new Request("https://desk.nopaiseh.com/api/owner/dashboard/writers", {
        method: "POST",
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
          agent_id: AGENT_B,
        }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
