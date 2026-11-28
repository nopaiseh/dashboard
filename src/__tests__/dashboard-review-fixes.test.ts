import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertDashboardStoredPayload,
  decryptBlockPayload,
  decryptBlockPayloadStrict,
  encryptBlockPayload,
} from "@/lib/dashboard/crypto";
import { planCreateBlock, planPatchBlock } from "@/lib/dashboard/logic";
import { normalizeDueAt } from "@/lib/dashboard/migrate-goals-plan";
import type {
  DashboardBlockRow,
  DashboardSectionRow,
} from "@/lib/dashboard/types";
import { FieldEncryptionError, resetFieldKeyringCache } from "@/lib/crypto/fields-core";
import {
  patchDashboardBlockSchema,
  createDashboardBlockSchema,
} from "@/lib/validation";
import { jsonOkNoStore } from "@/lib/http";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const BLOCK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

describe("Cache-Control: no-store", () => {
  it("jsonOkNoStore sets Cache-Control no-store", () => {
    const res = jsonOkNoStore({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("dashboard payload envelope versions", () => {
  it("assertDashboardStoredPayload rejects non-envelope plaintext", () => {
    expect(() => assertDashboardStoredPayload("secret title")).toThrow(
      FieldEncryptionError,
    );
    expect(() => assertDashboardStoredPayload("not-an-envelope")).toThrow(
      FieldEncryptionError,
    );
  });

  it("allows empty string and valid v1 envelope", () => {
    expect(() => assertDashboardStoredPayload("")).not.toThrow();
    const enc = encryptBlockPayload(BLOCK_ID, { text: "hi" });
    expect(enc.startsWith("v1:")).toBe(true);
    expect(() => assertDashboardStoredPayload(enc)).not.toThrow();
  });

  it("accepts a valid v2 envelope when v2 key is in the keyring", () => {
    const KEY_V2 = Buffer.alloc(32, 2).toString("base64");
    setEnv({
      FIELD_ENCRYPTION_KEY_V1: KEY_V1,
      FIELD_ENCRYPTION_KEY_V2: KEY_V2,
      FIELD_ENCRYPTION_KEY_CURRENT: "2",
      NODE_ENV: "test",
    });
    const enc = encryptBlockPayload(BLOCK_ID, { text: "v2 hi" });
    expect(enc.startsWith("v2:")).toBe(true);
    expect(() => assertDashboardStoredPayload(enc)).not.toThrow();
    expect(decryptBlockPayloadStrict({ id: BLOCK_ID, payload: enc })).toEqual({
      text: "v2 hi",
    });
  });

  it("treats unknown envelope version as decrypt failure", () => {
    const KEY_V2 = Buffer.alloc(32, 2).toString("base64");
    setEnv({
      FIELD_ENCRYPTION_KEY_V1: KEY_V1,
      FIELD_ENCRYPTION_KEY_V2: KEY_V2,
      FIELD_ENCRYPTION_KEY_CURRENT: "2",
      NODE_ENV: "test",
    });
    const enc = encryptBlockPayload(BLOCK_ID, { text: "only-v2" });
    setEnv({
      FIELD_ENCRYPTION_KEY: KEY_V1,
      NODE_ENV: "test",
    });
    const result = decryptBlockPayload({ id: BLOCK_ID, payload: enc });
    expect(result.decrypt_failed).toBe(true);
    expect(() =>
      decryptBlockPayloadStrict({ id: BLOCK_ID, payload: enc }),
    ).toThrow(/unknown_key_version|no decryption key|version/);
  });

  it("decryptBlockPayload marks plaintext as decrypt_failed", () => {
    const result = decryptBlockPayload({
      id: BLOCK_ID,
      payload: "legacy plaintext",
    });
    expect(result.decrypt_failed).toBe(true);
    expect(result.payload).toEqual({});
  });

  it("decryptBlockPayloadStrict throws on plaintext", () => {
    expect(() =>
      decryptBlockPayloadStrict({
        id: BLOCK_ID,
        payload: "legacy plaintext",
      }),
    ).toThrow(/versioned envelope|legacy_plaintext/);
  });
});

describe("PATCH block_type requires payload", () => {
  it("zod rejects block_type without payload", () => {
    const parsed = patchDashboardBlockSchema.safeParse({
      block_type: "headline",
    });
    expect(parsed.success).toBe(false);
  });

  it("zod accepts block_type with matching payload", () => {
    const parsed = patchDashboardBlockSchema.safeParse({
      block_type: "headline",
      payload: { text: "一行标题" },
    });
    expect(parsed.success).toBe(true);
  });

  it("planPatchBlock rejects type change without payload", () => {
    const block: DashboardBlockRow = {
      id: BLOCK_ID,
      section_id: SECTION_ID,
      block_type: "progress",
      sort_order: 0,
      agent_id: AGENT_A,
      payload: "v1:x",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const planned = planPatchBlock(AGENT_A, block, {
      block_type: "headline",
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.status).toBe(400);
  });

  it("strict schema rejects agent_id / section_id on PATCH", () => {
    const withAgent = patchDashboardBlockSchema.safeParse({
      sort_order: 1,
      agent_id: AGENT_B,
    });
    expect(withAgent.success).toBe(false);
    const withSection = patchDashboardBlockSchema.safeParse({
      sort_order: 1,
      section_id: SECTION_ID,
    });
    expect(withSection.success).toBe(false);
  });
});

describe("sister cannot write into another sister section", () => {
  it("planCreateBlock returns 403", () => {
    const section: DashboardSectionRow = {
      id: SECTION_ID,
      category: "cpf",
      sort_order: 0,
      agent_id: AGENT_A,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const planned = planCreateBlock(AGENT_B, section, {
      section_id: SECTION_ID,
      block_type: "headline",
      payload: { text: "nope" },
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.status).toBe(403);
  });
});

describe("normalizeDueAt", () => {
  it("normalizes +00:00 to .000Z", () => {
    expect(normalizeDueAt("2027-01-01T00:00:00+00:00")).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });

  it("passes null through", () => {
    expect(normalizeDueAt(null)).toBeNull();
  });
});

describe("dashboard route review fixes", () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
  });

  it("GET /api/dashboard sets Cache-Control: no-store", async () => {
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/read/data", () => ({
      loadDashboard: async () => ({ headline: "", sections: [] }),
    }));

    const { GET } = await import("@/app/api/dashboard/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("POST /blocks into another sister section returns 403", async () => {
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
        from: () => ({
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
        }),
        rpc: async () => {
          throw new Error("rpc should not be called");
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
          block_type: "headline",
          payload: { text: "stolen" },
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("POST /blocks sets no-store and uses RPC", async () => {
    const enc = encryptBlockPayload(BLOCK_ID, { text: "ok" });
    let rpcCalled = false;
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/agent-service", () => ({
      resolveAgentFromRequest: async () => ({
        ok: true,
        agent: { agentId: AGENT_A, tokenHash: "hash" },
      }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
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
        }),
        rpc: async (name: string, args: Record<string, unknown>) => {
          rpcCalled = true;
          expect(name).toBe("create_dashboard_block");
          expect(args.p_payload).toMatch(/^v1:/);
          return {
            data: {
              block: {
                id: args.p_id,
                section_id: SECTION_ID,
                block_type: "headline",
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
          block_type: "headline",
          payload: { text: "ok" },
        }),
      }),
    );
    expect(rpcCalled).toBe(true);
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("PATCH type without payload returns 400", async () => {
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/agent-service", () => ({
      resolveAgentFromRequest: async () => ({
        ok: true,
        agent: { agentId: AGENT_A, tokenHash: "hash" },
      }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: BLOCK_ID,
                  section_id: SECTION_ID,
                  block_type: "progress",
                  sort_order: 0,
                  agent_id: AGENT_A,
                  payload: encryptBlockPayload(BLOCK_ID, {
                    title: "t",
                    progress: 0,
                  }),
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-01T00:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        }),
        rpc: async () => {
          throw new Error("rpc should not be called");
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
        body: JSON.stringify({ block_type: "headline" }),
      }),
      { params: Promise.resolve({ id: BLOCK_ID }) },
    );
    expect(res.status).toBe(400);
  });

  it("PATCH returns 500 when RPC/audit fails (no silent swallow)", async () => {
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/agent-service", () => ({
      resolveAgentFromRequest: async () => ({
        ok: true,
        agent: { agentId: AGENT_A, tokenHash: "hash" },
      }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: BLOCK_ID,
                  section_id: SECTION_ID,
                  block_type: "progress",
                  sort_order: 0,
                  agent_id: AGENT_A,
                  payload: encryptBlockPayload(BLOCK_ID, {
                    title: "t",
                    progress: 0,
                  }),
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-01T00:00:00.000Z",
                },
                error: null,
              }),
            }),
          }),
        }),
        rpc: async () => ({
          data: null,
          error: { code: "XJ409", message: "failed to write event" },
        }),
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
        body: JSON.stringify({ sort_order: 2 }),
      }),
      { params: Promise.resolve({ id: BLOCK_ID }) },
    );
    expect(res.status).toBe(409);
  });

  it("createDashboardBlockSchema rejects unknown keys like agent_id", () => {
    const parsed = createDashboardBlockSchema.safeParse({
      section_id: SECTION_ID,
      block_type: "headline",
      payload: { text: "x" },
      agent_id: AGENT_B,
    });
    expect(parsed.success).toBe(false);
  });
});
