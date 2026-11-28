/**
 * Bank dashboard backend: whitelist cross-checks, token categories, strict
 * payloads, privacy hits, upsert. All amounts / keys are FAKE fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BANK_BLOCK_KEYS } from "@/lib/bank-block-keys";
import { CPF_BLOCK_KEYS } from "@/lib/cpf-block-keys";
import { parseBankBlockPayload } from "@/lib/dashboard/bank-validation";
import { isBlockKeyAllowedForCategory } from "@/lib/dashboard/block-key-policy";
import { normalizeDashboardCategories } from "@/lib/dashboard/category";
import {
  containsSingaporeNricOrFin,
  isForbiddenDashboardIdentifierKey,
  stringContainsLongDigitRun,
} from "@/lib/dashboard/nric-guard";
import { amountsEqualInCents } from "@/lib/dashboard/money";
import { parseDashboardBlockPayload } from "@/lib/dashboard/parse-payload";
import { DASHBOARD_INVALID_PAYLOAD_ERROR } from "@/lib/dashboard/write-errors";
import { encryptBlockPayload } from "@/lib/dashboard/crypto";
import { resetFieldKeyringCache } from "@/lib/crypto/fields-core";
import { backfillDashboardWriters } from "@/lib/dashboard/writers";
import { mockDashboardWritersFrom } from "./helpers/dashboard-writer-mock";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** FAKE bank balance card — not a real account. */
const FAKE_BANK_ACC_PAYLOAD = {
  block_key: "bank_acc_hsbc" as const,
  title: "FAKE HSBC",
  role_tag: "薪资",
  group: "hub" as const,
  value: 0,
  label: "FAKE",
  unit: "S$" as const,
};

function setEnv() {
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
  process.env.FIELD_ENCRYPTION_KEY = KEY_V1;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
  resetFieldKeyringCache();
}

beforeEach(() => {
  setEnv();
});

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  resetFieldKeyringCache();
});

describe("bank block_key whitelist (28 keys + cross category)", () => {
  it("lists exactly 28 bank keys", () => {
    expect(BANK_BLOCK_KEYS).toHaveLength(28);
  });

  it("rejects CPF key in bank partition and bank key in CPF partition", () => {
    expect(isBlockKeyAllowedForCategory("bank", "cpf_acc_oa")).toBe(false);
    expect(isBlockKeyAllowedForCategory("cpf", "bank_acc_hsbc")).toBe(false);
    expect(isBlockKeyAllowedForCategory("bank", "bank_acc_hsbc")).toBe(true);
    expect(isBlockKeyAllowedForCategory("cpf", "cpf_acc_oa")).toBe(true);
  });

  it("parseDashboardBlockPayload cross-rejects keys", () => {
    expect(
      parseDashboardBlockPayload(
        "metric",
        { title: "OA", value: 1, block: "S$", block_key: "cpf_acc_oa" },
        "bank",
      ).ok,
    ).toBe(false);
    expect(
      parseDashboardBlockPayload(
        "metric",
        FAKE_BANK_ACC_PAYLOAD,
        "cpf",
      ).ok,
    ).toBe(false);
    expect(
      parseDashboardBlockPayload("metric", FAKE_BANK_ACC_PAYLOAD, "bank").ok,
    ).toBe(true);
  });
});

describe("dashboard writers", () => {
  it("backfill: unique section owner becomes writer; bank inherits cpf", () => {
    expect(
      backfillDashboardWriters([
        { category: "cpf", agent_id: AGENT_A },
        { category: "travel", agent_id: AGENT_B },
      ]),
    ).toEqual([
      { category: "bank", writer_agent_id: AGENT_A },
      { category: "cpf", writer_agent_id: AGENT_A },
      { category: "travel", writer_agent_id: AGENT_B },
    ]);
  });

  it("backfill: multi-owner category omitted; bank still inherits cpf", () => {
    expect(
      backfillDashboardWriters([
        { category: "cpf", agent_id: AGENT_A },
        { category: "travel", agent_id: AGENT_A },
        { category: "travel", agent_id: AGENT_B },
      ]),
    ).toEqual([
      { category: "bank", writer_agent_id: AGENT_A },
      { category: "cpf", writer_agent_id: AGENT_A },
    ]);
  });

  it("writer may create section; non-writer and unset category → 403", async () => {
    for (const [agentId, writers, category, expected] of [
      [AGENT_A, { bank: AGENT_A }, "bank", 201],
      [AGENT_B, { bank: AGENT_A }, "bank", 403],
      [AGENT_A, {}, "bank", 403],
    ] as const) {
      vi.resetModules();
      setEnv();
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
                        category,
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
          body: JSON.stringify({ category }),
        }),
      );
      expect(res.status, `${agentId}:${category}`).toBe(expected);
    }
  });

  it("non-writer block write → 403 even if they own the section row", async () => {
    vi.resetModules();
    setEnv();
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
            return mockDashboardWritersFrom({ bank: AGENT_A });
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: SECTION_ID,
                    category: "bank",
                    sort_order: 0,
                    agent_id: AGENT_B,
                    created_at: "2026-01-01T00:00:00.000Z",
                    updated_at: "2026-01-01T00:00:00.000Z",
                  },
                  error: null,
                }),
              }),
            }),
          };
        },
        rpc: async () => {
          throw new Error("rpc should not run");
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
          payload: FAKE_BANK_ACC_PAYLOAD,
        }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

describe("bank strict field validation", () => {
  it("accepts 0, negative net, and progress > 100 (FAKE)", () => {
    expect(
      parseBankBlockPayload(
        "metric",
        { ...FAKE_BANK_ACC_PAYLOAD, value: 0 },
        "bank_acc_hsbc",
      ).ok,
    ).toBe(true);
    expect(
      parseBankBlockPayload(
        "metric",
        {
          block_key: "bank_net",
          value: -100.5,
          cash_total: 50,
          liab_total: 150.5,
          label: "FAKE net",
          unit: "S$",
        },
        "bank_net",
      ).ok,
    ).toBe(true);
    expect(
      parseBankBlockPayload(
        "progress",
        {
          block_key: "bank_prog_emergency",
          title: "FAKE emergency",
          account_key: "gxs",
          kind: "floor",
          value: 100,
          target: 50,
          unit: "S$",
          progress: 200,
          due: "2026-12",
          status: "ahead",
          status_text: "超标",
          milestones: [],
          label: "FAKE",
          note: "FAKE note",
        },
        "bank_prog_emergency",
      ).ok,
    ).toBe(true);
  });

  it("rejects bank_net when value != cash_total - liab_total (cents)", () => {
    expect(amountsEqualInCents(1.005, 1.004)).toBe(true);
    expect(
      parseBankBlockPayload(
        "metric",
        {
          block_key: "bank_net",
          value: 10,
          cash_total: 100,
          liab_total: 50,
          label: "FAKE",
          unit: "S$",
        },
        "bank_net",
      ).ok,
    ).toBe(false);
  });

  it("rejects bank_ledger when in_total/out_total mismatch lines", () => {
    const month = JSON.stringify({
      month: "2026-11",
      in_total: 100,
      out_total: 40,
      lines: [
        { kind: "in", category: "salary", amount: 90 },
        { kind: "out", category: "food", amount: 40 },
      ],
    });
    expect(
      parseBankBlockPayload(
        "list",
        {
          block_key: "bank_ledger",
          items: [month],
        },
        "bank_ledger",
      ).ok,
    ).toBe(false);

    const okMonth = JSON.stringify({
      month: "2026-11",
      in_total: 90,
      out_total: 40,
      lines: [
        { kind: "in", category: "salary", amount: 90 },
        { kind: "out", category: "food", amount: 40 },
      ],
    });
    expect(
      parseBankBlockPayload(
        "list",
        {
          block_key: "bank_ledger",
          items: [okMonth],
        },
        "bank_ledger",
      ).ok,
    ).toBe(true);
  });

  it("rejects unknown fields via .strict() and bad unit", () => {
    expect(
      parseBankBlockPayload(
        "metric",
        { ...FAKE_BANK_ACC_PAYLOAD, extra: 1 },
        "bank_acc_hsbc",
      ).ok,
    ).toBe(false);
    expect(
      parseBankBlockPayload(
        "metric",
        { ...FAKE_BANK_ACC_PAYLOAD, unit: "SGD" },
        "bank_acc_hsbc",
      ).ok,
    ).toBe(false);
  });

  it("requires monthly_needed for kind=savings", () => {
    const base = {
      block_key: "bank_prog_gxs",
      title: "FAKE",
      account_key: "gxs",
      kind: "savings" as const,
      value: 1,
      target: 10,
      unit: "S$" as const,
      progress: 0.1,
      due: "2026-12",
      status: "on_track" as const,
      status_text: "ok",
      milestones: [],
      label: "FAKE",
      note: "",
    };
    expect(parseBankBlockPayload("progress", base, "bank_prog_gxs").ok).toBe(
      false,
    );
    expect(
      parseBankBlockPayload(
        "progress",
        { ...base, monthly_needed: 1 },
        "bank_prog_gxs",
      ).ok,
    ).toBe(true);
  });
});

describe("privacy guard bank extensions (CPF-safe)", () => {
  it("blocks new forbidden key names", () => {
    for (const key of [
      "cardNo",
      "card_number",
      "last4",
      "iban",
      "SWIFT",
      "pan",
    ]) {
      expect(isForbiddenDashboardIdentifierKey(key)).toBe(true);
      expect(containsSingaporeNricOrFin({ [key]: "x" })).toBe(true);
    }
  });

  it("blocks 9+ consecutive digits without echoing", () => {
    expect(stringContainsLongDigitRun("12345678")).toBe(false);
    expect(stringContainsLongDigitRun("123456789")).toBe(true);
    expect(containsSingaporeNricOrFin({ note: "ref 123456789" })).toBe(true);
  });

  it("does not false-positive CPF-like numeric amounts / dates", () => {
    // FAKE CPF-shaped payload: numbers are not digit-scanned as strings.
    expect(
      containsSingaporeNricOrFin({
        title: "OA",
        value: 205_181,
        unit: "S$",
        delta_mom: 1840,
        text: "余额 S$1234 · 年份 2024",
        missing_years: [2019, 2020],
        series: [{ t: "2026-01", v: 10000000 }],
      }),
    ).toBe(false);
    // Every CPF whitelist key name itself is safe.
    for (const key of CPF_BLOCK_KEYS) {
      expect(containsSingaporeNricOrFin({ block_key: key })).toBe(false);
    }
  });
});

describe("upsert by block_key", () => {
  function mockAuth() {
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/agent-service", () => ({
      resolveAgentFromRequest: async () => ({
        ok: true,
        agent: {
          agentId: AGENT_A,
          tokenHash: "hash",
        },
      }),
    }));
  }

  it("creates then replaces via PUT (FAKE payload)", async () => {
    mockAuth();
    let call = 0;
    const enc1 = encryptBlockPayload(BLOCK_ID, FAKE_BANK_ACC_PAYLOAD);
    const enc2 = encryptBlockPayload(BLOCK_ID, {
      ...FAKE_BANK_ACC_PAYLOAD,
      value: -1,
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SECTION_ID,
                      category: "bank",
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
          // existing key lookup
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    call += 1;
                    if (call === 1) {
                      return { data: null, error: null };
                    }
                    return { data: { id: BLOCK_ID }, error: null };
                  },
                }),
              }),
            }),
          };
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          expect(name).toBe("upsert_dashboard_block_by_key");
          expect(args.p_block_key).toBe("bank_acc_hsbc");
          const inserted = args.p_id !== BLOCK_ID || call === 1;
          // After first create, second call uses existing BLOCK_ID
          const id = (args.p_id as string) ?? BLOCK_ID;
          return {
            data: {
              inserted: call <= 1,
              block: {
                id: call <= 1 ? id : BLOCK_ID,
                section_id: SECTION_ID,
                block_type: "metric",
                sort_order: 0,
                agent_id: AGENT_A,
                block_key: "bank_acc_hsbc",
                payload: call <= 1 ? enc1 : enc2,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
            },
            error: null,
          };
          void inserted;
        },
      }),
    }));

    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );

    const createRes = await PUT(
      new Request(
        `http://localhost/api/agent/dashboard/sections/${SECTION_ID}/blocks/bank_acc_hsbc`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            block_type: "metric",
            payload: FAKE_BANK_ACC_PAYLOAD,
          }),
        },
      ),
      {
        params: Promise.resolve({
          id: SECTION_ID,
          block_key: "bank_acc_hsbc",
        }),
      },
    );
    expect(createRes.status).toBe(201);

    vi.resetModules();
    setEnv();
    mockAuth();
    call = 1;
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SECTION_ID,
                      category: "bank",
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
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: BLOCK_ID },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        },
        rpc: async () => ({
          data: {
            inserted: false,
            block: {
              id: BLOCK_ID,
              section_id: SECTION_ID,
              block_type: "metric",
              sort_order: 0,
              agent_id: AGENT_A,
              block_key: "bank_acc_hsbc",
              payload: enc2,
              created_at: "2026-01-01T00:00:00.000Z",
              updated_at: "2026-01-01T00:00:00.000Z",
            },
          },
          error: null,
        }),
      }),
    }));

    const { PUT: PUT2 } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const replaceRes = await PUT2(
      new Request(
        `http://localhost/api/agent/dashboard/sections/${SECTION_ID}/blocks/bank_acc_hsbc`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            block_type: "metric",
            payload: { ...FAKE_BANK_ACC_PAYLOAD, value: -1 },
          }),
        },
      ),
      {
        params: Promise.resolve({
          id: SECTION_ID,
          block_key: "bank_acc_hsbc",
        }),
      },
    );
    expect(replaceRes.status).toBe(200);
  });

  it("rejects CPF key upsert into bank section with identical 400 body", async () => {
    mockAuth();
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: SECTION_ID,
                    category: "bank",
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
        },
      }),
    }));

    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
      new Request(
        `http://localhost/api/agent/dashboard/sections/${SECTION_ID}/blocks/cpf_acc_oa`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            block_type: "metric",
            payload: { title: "OA", value: 1, block: "S$" },
          }),
        },
      ),
      {
        params: Promise.resolve({ id: SECTION_ID, block_key: "cpf_acc_oa" }),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: DASHBOARD_INVALID_PAYLOAD_ERROR,
    });
  });
});

describe("agent write logging hygiene", () => {
  it("create_dashboard_block error log omits payload and token hash", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@/lib/require-request", () => ({
      requireRequest: async () => undefined,
    }));
    vi.doMock("@/lib/agent-service", () => ({
      resolveAgentFromRequest: async () => ({
        ok: true,
        agent: {
          agentId: AGENT_A,
          tokenHash: "deadbeef".repeat(8),
        },
      }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
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
          throw new Error(`unexpected ${table}`);
        },
        rpc: async () => ({
          data: null,
          error: { code: "57014", message: "fail" },
        }),
      }),
    }));

    const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
    const res = await POST(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "headline",
          payload: { text: "FAKE secret headline should not be logged" },
        }),
      }),
    );
    expect(res.status).toBe(500);

    expect(errorSpy).toHaveBeenCalled();
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("FAKE secret headline");
    expect(logged).not.toContain("deadbeef");
    expect(logged).not.toMatch(/"payload"/);
  });
});
