/**
 * Bank dashboard backend: whitelist cross-checks, token categories, strict
 * payloads, privacy hits, upsert. All amounts / keys are FAKE fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BANK_BLOCK_KEYS } from "@/lib/bank-block-keys";
import { CPF_BLOCK_KEYS } from "@/lib/cpf-block-keys";
import {
  BANK_LEDGER_LIST_ITEMS_MAX,
  BANK_LEDGER_MONTH_JSON_MAX,
  parseBankBlockPayload,
} from "@/lib/dashboard/bank-validation";
import { isBlockKeyAllowedForCategory } from "@/lib/dashboard/block-key-policy";
import {
  containsSingaporeNricOrFin,
  isForbiddenDashboardIdentifierKey,
  stringContainsLongDigitRun,
} from "@/lib/dashboard/nric-guard";
import { amountsEqualInCents } from "@/lib/dashboard/money";
import { parseDashboardBlockPayload } from "@/lib/dashboard/parse-payload";
import {
  DASHBOARD_BLOCK_KEY_CONFLICT_ERROR,
  DASHBOARD_INVALID_PAYLOAD_ERROR,
} from "@/lib/dashboard/write-errors";
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
  it("backfill: ordinary cats get all owners; unique cpf → cpf+bank", () => {
    expect(
      backfillDashboardWriters([
        { category: "cpf", agent_id: AGENT_A },
        { category: "travel", agent_id: AGENT_B },
        { category: "bank", agent_id: AGENT_B },
      ]),
    ).toEqual([
      { category: "bank", agent_id: AGENT_A },
      { category: "cpf", agent_id: AGENT_A },
      { category: "travel", agent_id: AGENT_B },
    ]);
  });

  it("backfill: multi-owner ordinary cats list all; multi cpf skips cpf+bank", () => {
    expect(
      backfillDashboardWriters([
        { category: "cpf", agent_id: AGENT_A },
        { category: "cpf", agent_id: AGENT_B },
        { category: "travel", agent_id: AGENT_A },
        { category: "travel", agent_id: AGENT_B },
        { category: "bank", agent_id: AGENT_A },
      ]),
    ).toEqual([
      { category: "travel", agent_id: AGENT_A },
      { category: "travel", agent_id: AGENT_B },
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

  it("accepts bank_ledger month with 200 lines (relaxed month JSON cap)", () => {
    const lines = Array.from({ length: BANK_LEDGER_LIST_ITEMS_MAX }, (_, i) => ({
      kind: i % 2 === 0 ? ("in" as const) : ("out" as const),
      category: "other" as const,
      amount: 1,
    }));
    const in_total = lines
      .filter((l) => l.kind === "in")
      .reduce((s, l) => s + l.amount, 0);
    const out_total = lines
      .filter((l) => l.kind === "out")
      .reduce((s, l) => s + l.amount, 0);
    const month = JSON.stringify({
      month: "2026-11",
      in_total,
      out_total,
      lines,
    });
    expect(month.length).toBeGreaterThan(500);
    expect(month.length).toBeLessThanOrEqual(BANK_LEDGER_MONTH_JSON_MAX);
    expect(
      parseBankBlockPayload(
        "list",
        { block_key: "bank_ledger", items: [month] },
        "bank_ledger",
      ).ok,
    ).toBe(true);
  });

  it("rejects bank_ledger month JSON above the sane overall cap", () => {
    const huge = "x".repeat(BANK_LEDGER_MONTH_JSON_MAX + 1);
    expect(
      parseBankBlockPayload(
        "list",
        { block_key: "bank_ledger", items: [huge] },
        "bank_ledger",
      ).ok,
    ).toBe(false);
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

  function bankSectionFrom() {
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

  /** Column lookup + optional legacy NULL-key scan. */
  function blocksFrom(opts: {
    columnId?: string | null;
    nullKeyRows?: Array<{ id: string; payload: string }>;
  }) {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: opts.columnId ? { id: opts.columnId } : null,
              error: null,
            }),
          }),
          is: () =>
            Promise.resolve({
              data: opts.nullKeyRows ?? [],
              error: null,
            }),
        }),
      }),
    };
  }

  it("creates then replaces via PUT (FAKE payload)", async () => {
    mockAuth();
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
            return bankSectionFrom();
          }
          return blocksFrom({ columnId: null, nullKeyRows: [] });
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          expect(name).toBe("upsert_dashboard_block_by_key");
          expect(args.p_block_key).toBe("bank_acc_hsbc");
          const id = (args.p_id as string) ?? BLOCK_ID;
          return {
            data: {
              inserted: true,
              block: {
                id,
                section_id: SECTION_ID,
                block_type: "metric",
                sort_order: 0,
                agent_id: AGENT_A,
                block_key: "bank_acc_hsbc",
                payload: enc1,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
            },
            error: null,
          };
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
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return bankSectionFrom();
          }
          return blocksFrom({ columnId: BLOCK_ID });
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

  it("legacy NULL block_key: unique decrypt match patches + backfills column", async () => {
    mockAuth();
    const LEGACY_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const legacyEnc = encryptBlockPayload(LEGACY_ID, {
      ...FAKE_BANK_ACC_PAYLOAD,
      value: 12.34,
    });
    const updatedEnc = encryptBlockPayload(LEGACY_ID, {
      ...FAKE_BANK_ACC_PAYLOAD,
      value: 56.78,
    });
    let patchArgs: Record<string, unknown> | null = null;

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return bankSectionFrom();
          }
          return blocksFrom({
            columnId: null,
            nullKeyRows: [{ id: LEGACY_ID, payload: legacyEnc }],
          });
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          expect(name).toBe("apply_agent_dashboard_block_patch");
          patchArgs = args;
          return {
            data: {
              block: {
                id: LEGACY_ID,
                section_id: SECTION_ID,
                block_type: "metric",
                sort_order: 0,
                agent_id: AGENT_A,
                block_key: "bank_acc_hsbc",
                payload: updatedEnc,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-02T00:00:00.000Z",
              },
            },
            error: null,
          };
        },
      }),
    }));

    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
      new Request(
        `http://localhost/api/agent/dashboard/sections/${SECTION_ID}/blocks/bank_acc_hsbc`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            block_type: "metric",
            payload: { ...FAKE_BANK_ACC_PAYLOAD, value: 56.78 },
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
    expect(res.status).toBe(200);
    expect(patchArgs).toMatchObject({
      p_block_id: LEGACY_ID,
      p_touch_block_key: true,
      p_block_key: "bank_acc_hsbc",
      p_touch_payload: true,
    });
    const body = (await res.json()) as {
      block: { id: string; payload: { value: number } };
    };
    expect(body.block.id).toBe(LEGACY_ID);
    expect(body.block.payload.value).toBe(56.78);
  });

  it("legacy NULL block_key: multiple decrypt matches → 409 without content", async () => {
    mockAuth();
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const encA = encryptBlockPayload(A, FAKE_BANK_ACC_PAYLOAD);
    const encB = encryptBlockPayload(B, FAKE_BANK_ACC_PAYLOAD);

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return bankSectionFrom();
          }
          return blocksFrom({
            columnId: null,
            nullKeyRows: [
              { id: A, payload: encA },
              { id: B, payload: encB },
            ],
          });
        },
        rpc: async () => {
          throw new Error("rpc must not run on multi-match conflict");
        },
      }),
    }));

    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
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
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: DASHBOARD_BLOCK_KEY_CONFLICT_ERROR,
    });
  });

  it("legacy NULL block_key: decrypt failure skipped → creates new row", async () => {
    mockAuth();
    const BAD_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    let rpcName: string | null = null;

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return bankSectionFrom();
          }
          return blocksFrom({
            columnId: null,
            nullKeyRows: [{ id: BAD_ID, payload: "not-a-v1-envelope" }],
          });
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          rpcName = name;
          expect(name).toBe("upsert_dashboard_block_by_key");
          expect(args.p_id).not.toBe(BAD_ID);
          return {
            data: {
              inserted: true,
              block: {
                id: args.p_id,
                section_id: SECTION_ID,
                block_type: "metric",
                sort_order: 0,
                agent_id: AGENT_A,
                block_key: "bank_acc_hsbc",
                payload: args.p_payload,
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
            },
            error: null,
          };
        },
      }),
    }));

    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
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
    expect(res.status).toBe(201);
    expect(rpcName).toBe("upsert_dashboard_block_by_key");
  });

  it("maps upsert id-mismatch XJ409 to 409 conflict for retry", async () => {
    mockAuth();
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return bankSectionFrom();
          }
          return blocksFrom({ columnId: null, nullKeyRows: [] });
        },
        rpc: async () => ({
          data: null,
          error: {
            code: "XJ409",
            message: "conflict: upsert block id mismatch",
          },
        }),
      }),
    }));

    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
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
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: DASHBOARD_BLOCK_KEY_CONFLICT_ERROR,
    });
  });

  it("omitted sort_order passes null so SQL preserves existing", async () => {
    mockAuth();
    const captured: { sort?: unknown } = {};
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return bankSectionFrom();
          }
          return blocksFrom({ columnId: BLOCK_ID });
        },
        rpc: async (_name: string, args: Record<string, unknown>) => {
          captured.sort = args.p_sort_order;
          return {
            data: {
              inserted: false,
              block: {
                id: BLOCK_ID,
                section_id: SECTION_ID,
                block_type: "metric",
                sort_order: 9,
                agent_id: AGENT_A,
                block_key: "bank_acc_hsbc",
                payload: encryptBlockPayload(BLOCK_ID, FAKE_BANK_ACC_PAYLOAD),
                created_at: "2026-01-01T00:00:00.000Z",
                updated_at: "2026-01-01T00:00:00.000Z",
              },
            },
            error: null,
          };
        },
      }),
    }));

    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
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
    expect(res.status).toBe(200);
    expect(captured.sort).toBeNull();
  });

  it("uses already-decoded block_key params (no second decode)", async () => {
    mockAuth();
    // Next would pass the already-decoded key; a literal "%" must not 500.
    const keyWithPercent = "bank_acc_hsbc%";
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ bank: AGENT_A, cpf: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return bankSectionFrom();
          }
          throw new Error("blocks lookup should not run for invalid key");
        },
      }),
    }));

    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
      new Request(
        `http://localhost/api/agent/dashboard/sections/${SECTION_ID}/blocks/${encodeURIComponent(keyWithPercent)}`,
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
          block_key: keyWithPercent,
        }),
      },
    );
    // Not a whitelisted key → 400 invalid payload (not URIError 500).
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: DASHBOARD_INVALID_PAYLOAD_ERROR,
    });
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
            payload: { title: "OA", value: 1, unit: "S$" },
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
