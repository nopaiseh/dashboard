import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptBlockPayload } from "@/lib/dashboard/crypto";

const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BLOCK_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "11111111-1111-4111-8111-111111111111";

describe("dashboard block PATCH ownership (route)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
    process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  });

  it("returns 403 when sister patches another sister's block", async () => {
    const payload = encryptBlockPayload(BLOCK_ID, {
      title: "x",
      progress: 0.1,
    });

    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/agent-service", () => ({
      resolveAgentFromRequest: async () => ({
        ok: true,
        agent: { agentId: AGENT_B, tokenHash: "hash" },
      }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { writer_agent_id: AGENT_A },
                    error: null,
                  }),
                }),
              }),
            };
          }
          if (table === "dashboard_blocks") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: BLOCK_ID,
                      section_id: SECTION_ID,
                      block_type: "progress",
                      sort_order: 0,
                      agent_id: AGENT_A,
                      payload,
                      created_at: "2026-01-01T00:00:00.000Z",
                      updated_at: "2026-01-01T00:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
              update: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      maybeSingle: async () => ({ data: null, error: null }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === "dashboard_sections") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SECTION_ID,
                      category: "cpf",
                      sort_order: 0,
                      agent_id: AGENT_A,
                      created_at: "2026-01-01T00:00:00.000Z",
                      updated_at: "2026-01-01T00:00:00.000Z",
                    },
                    error: null,
                  }),
                }),
              }),
            };
          }
          return {
            insert: async () => ({ error: null }),
          };
        },
      }),
    }));

    const { PATCH } = await import(
      "@/app/api/agent/dashboard/blocks/[id]/route"
    );
    const res = await PATCH(
      new Request(`http://localhost/api/agent/dashboard/blocks/${BLOCK_ID}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer xjg_at_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({ sort_order: 9 }),
      }),
      { params: Promise.resolve({ id: BLOCK_ID }) },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("forbidden");
  });
});
