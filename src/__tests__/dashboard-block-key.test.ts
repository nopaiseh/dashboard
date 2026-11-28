import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CPF_BLOCK_KEYS } from "@/lib/cpf-block-keys";
import {
  DASHBOARD_BLOCK_KEY_CONFLICT_ERROR,
  DASHBOARD_INVALID_PAYLOAD_ERROR,
} from "@/lib/dashboard/write-errors";
import { encryptBlockPayload } from "@/lib/dashboard/crypto";
import { resetFieldKeyringCache } from "@/lib/crypto/fields-core";
import {
  createDashboardBlockSchema,
  dashboardPayloadSchemaFor,
} from "@/lib/validation";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_BLOCK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const CONFLICT_BODY = { error: DASHBOARD_BLOCK_KEY_CONFLICT_ERROR };
const INVALID_BODY = { error: DASHBOARD_INVALID_PAYLOAD_ERROR };

function setEnv(vars: Record<string, string | undefined>) {
  for (const name of [
    "FIELD_ENCRYPTION_KEY",
    "FIELD_ENCRYPTION_KEY_V1",
    "FIELD_ENCRYPTION_KEY_V2",
    "FIELD_ENCRYPTION_KEY_CURRENT",
    "FIELD_ENCRYPTION_KEYS",
    "NODE_ENV",
  ]) {
    delete process.env[name];
  }
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetFieldKeyringCache();
}

beforeEach(() => {
  setEnv({ FIELD_ENCRYPTION_KEY: KEY_V1, NODE_ENV: "test" });
});

afterEach(() => {
  setEnv({});
  vi.resetModules();
  vi.restoreAllMocks();
});

const SAMPLE_PAYLOADS: Record<
  "headline" | "text" | "metric" | "progress" | "list" | "chart_series",
  Record<string, unknown>
> = {
  headline: { text: "一行标题" },
  text: { text: "说明文字" },
  metric: { title: "OA", value: 100 },
  progress: { title: "MA", progress: 0.5 },
  list: { items: ["a"] },
  chart_series: { series: [{ t: "2026-01", v: 1 }] },
};

describe("block_key payload whitelist", () => {
  it("accepts every whitelisted key on each block payload schema", () => {
    for (const blockType of Object.keys(SAMPLE_PAYLOADS) as Array<
      keyof typeof SAMPLE_PAYLOADS
    >) {
      for (const key of CPF_BLOCK_KEYS) {
        const parsed = dashboardPayloadSchemaFor(blockType).safeParse({
          ...SAMPLE_PAYLOADS[blockType],
          block_key: key,
        });
        expect(parsed.success, `${blockType}/${key}`).toBe(true);
      }
    }
  });

  it("rejects an unknown block_key with schema failure (API → 400)", () => {
    const parsed = dashboardPayloadSchemaFor("metric").safeParse({
      title: "OA",
      value: 1,
      block_key: "cpf_unknown_slot",
    });
    expect(parsed.success).toBe(false);

    const createParsed = createDashboardBlockSchema.safeParse({
      section_id: SECTION_ID,
      block_type: "metric",
      payload: {
        title: "OA",
        value: 1,
        block_key: "not_in_whitelist",
      },
    });
    expect(createParsed.success).toBe(false);
  });

  it("rejects a non-string block_key", () => {
    expect(
      dashboardPayloadSchemaFor("text").safeParse({
        text: "hi",
        block_key: 42,
      }).success,
    ).toBe(false);
    expect(
      dashboardPayloadSchemaFor("list").safeParse({
        items: ["a"],
        block_key: null,
      }).success,
    ).toBe(false);
    expect(
      dashboardPayloadSchemaFor("headline").safeParse({
        text: "hi",
        block_key: ["cpf_conclusion"],
      }).success,
    ).toBe(false);
  });

  it("accepts payloads without block_key", () => {
    for (const [blockType, payload] of Object.entries(SAMPLE_PAYLOADS) as Array<
      [keyof typeof SAMPLE_PAYLOADS, Record<string, unknown>]
    >) {
      expect(
        dashboardPayloadSchemaFor(blockType).safeParse(payload).success,
      ).toBe(true);
    }
  });
});

describe("block_key API uniqueness", () => {
  function mockAuth() {
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/agent-service", () => ({
      resolveAgentFromRequest: async () => ({
        ok: true,
        agent: { agentId: AGENT_A, tokenHash: "hash" },
      }),
    }));
  }

  it("POST returns 400 for unknown block_key without reaching DB", async () => {
    mockAuth();
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => {
          throw new Error("should not reach db");
        },
        rpc: () => {
          throw new Error("should not reach rpc");
        },
      }),
    }));

    const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
    const res = await POST(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: {
          authorization: "Bearer xjg_at_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "metric",
          payload: {
            title: "OA",
            value: 1,
            block_key: "cpf_not_real",
          },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID_BODY);
  });

  it("POST returns 400 for non-string block_key", async () => {
    mockAuth();
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => {
          throw new Error("should not reach db");
        },
        rpc: () => {
          throw new Error("should not reach rpc");
        },
      }),
    }));

    const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
    const res = await POST(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: {
          authorization: "Bearer xjg_at_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "text",
          payload: { text: "hi", block_key: 1 },
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(INVALID_BODY);
  });

  it("POST returns 409 when another block in the section already has the key", async () => {
    mockAuth();
    const siblingEnc = encryptBlockPayload(OTHER_BLOCK_ID, {
      title: "OA",
      value: 9,
      block_key: "cpf_acc_oa",
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
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
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [{ id: OTHER_BLOCK_ID, payload: siblingEnc }],
                  error: null,
                }),
            }),
          };
        },
        rpc: async () => {
          throw new Error("rpc should not be called on conflict");
        },
      }),
    }));

    const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
    const res = await POST(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: {
          authorization: "Bearer xjg_at_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "metric",
          payload: {
            title: "OA",
            value: 1,
            block_key: "cpf_acc_oa",
          },
        }),
      }),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual(CONFLICT_BODY);
    expect(JSON.stringify(body)).not.toContain("cpf_acc_oa");
    expect(JSON.stringify(body)).not.toContain("title");
  });

  it("POST without block_key still succeeds", async () => {
    mockAuth();
    let rpcCalled = false;
    const createdId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const enc = encryptBlockPayload(createdId, { title: "OA", value: 1 });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
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
          throw new Error("siblings query should not run without block_key");
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          rpcCalled = true;
          expect(name).toBe("create_dashboard_block");
          return {
            data: {
              block: {
                id: args.p_id,
                section_id: SECTION_ID,
                block_type: "metric",
                sort_order: 0,
                agent_id: AGENT_A,
                payload: enc,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
            },
            error: null,
          };
        },
      }),
    }));

    const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
    const res = await POST(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: {
          authorization: "Bearer xjg_at_test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "metric",
          payload: { title: "OA", value: 1 },
        }),
      }),
    );
    expect(rpcCalled).toBe(true);
    expect(res.status).toBe(201);
  });

  it("PATCH returns 409 when switching to a key owned by another block", async () => {
    mockAuth();
    const selfEnc = encryptBlockPayload(BLOCK_ID, {
      title: "SA",
      value: 2,
      block_key: "cpf_acc_sa",
    });
    const otherEnc = encryptBlockPayload(OTHER_BLOCK_ID, {
      title: "OA",
      value: 9,
      block_key: "cpf_acc_oa",
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: (col: string) => {
              if (col === "id") {
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: BLOCK_ID,
                      section_id: SECTION_ID,
                      block_type: "metric",
                      sort_order: 0,
                      agent_id: AGENT_A,
                      payload: selfEnc,
                      created_at: "2026-01-01T00:00:00.000Z",
                      updated_at: "2026-01-01T00:00:00.000Z",
                    },
                    error: null,
                  }),
                };
              }
              return Promise.resolve({
                data: [
                  { id: BLOCK_ID, payload: selfEnc },
                  { id: OTHER_BLOCK_ID, payload: otherEnc },
                ],
                error: null,
              });
            },
          }),
        }),
        rpc: async () => {
          throw new Error("rpc should not be called on conflict");
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
        body: JSON.stringify({
          payload: {
            title: "OA",
            value: 3,
            block_key: "cpf_acc_oa",
          },
        }),
      }),
      { params: Promise.resolve({ id: BLOCK_ID }) },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(CONFLICT_BODY);
  });

  it("PATCH allows keeping the block's own block_key", async () => {
    mockAuth();
    let rpcCalled = false;
    const selfEnc = encryptBlockPayload(BLOCK_ID, {
      title: "OA",
      value: 2,
      block_key: "cpf_acc_oa",
    });
    const updatedEnc = encryptBlockPayload(BLOCK_ID, {
      title: "OA",
      value: 3,
      block_key: "cpf_acc_oa",
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: (col: string) => {
              if (col === "id") {
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: BLOCK_ID,
                      section_id: SECTION_ID,
                      block_type: "metric",
                      sort_order: 0,
                      agent_id: AGENT_A,
                      payload: selfEnc,
                      created_at: "2026-01-01T00:00:00.000Z",
                      updated_at: "2026-01-01T00:00:00.000Z",
                    },
                    error: null,
                  }),
                };
              }
              return Promise.resolve({
                data: [{ id: BLOCK_ID, payload: selfEnc }],
                error: null,
              });
            },
          }),
        }),
        rpc: async () => {
          rpcCalled = true;
          return {
            data: {
              block: {
                id: BLOCK_ID,
                section_id: SECTION_ID,
                block_type: "metric",
                sort_order: 0,
                agent_id: AGENT_A,
                payload: updatedEnc,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
            },
            error: null,
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
        body: JSON.stringify({
          payload: {
            title: "OA",
            value: 3,
            block_key: "cpf_acc_oa",
          },
        }),
      }),
      { params: Promise.resolve({ id: BLOCK_ID }) },
    );
    expect(rpcCalled).toBe(true);
    expect(res.status).toBe(200);
  });
});
