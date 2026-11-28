/**
 * Travel dashboard backend: whitelist, strict payloads, privacy, writers.
 * All destinations / flights / hotels are FAKE fixtures — never real booking
 * data, personal forms of address, or hardcoded agent product ids.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BANK_BLOCK_KEYS } from "@/lib/bank-block-keys";
import { CPF_BLOCK_KEYS } from "@/lib/cpf-block-keys";
import { isBlockKeyAllowedForCategory } from "@/lib/dashboard/block-key-policy";
import {
  containsSingaporeNricOrFin,
  isForbiddenDashboardIdentifierKey,
  stringContainsBookingKeywordRef,
  stringContainsPassportLike,
  stringContainsSeparatedCardNumber,
  stringIsFullBookingRef,
  stringContainsLongDigitRun,
} from "@/lib/dashboard/nric-guard";
import { parseDashboardBlockPayload } from "@/lib/dashboard/parse-payload";
import {
  expectedTravelBlockType,
  parseTravelBlockPayload,
} from "@/lib/dashboard/travel-validation";
import { DASHBOARD_INVALID_PAYLOAD_ERROR } from "@/lib/dashboard/write-errors";
import { encryptBlockPayload } from "@/lib/dashboard/crypto";
import { resetFieldKeyringCache } from "@/lib/crypto/fields-core";
import { backfillDashboardWriters } from "@/lib/dashboard/writers";
import {
  isTravelBlockKey,
  parseTravelBlockKey,
  TRAVEL_BLOCK_KEYS,
  travelBlockKeyFor,
} from "@/lib/travel-block-keys";
import { mockDashboardWritersFrom } from "./helpers/dashboard-writer-mock";

const KEY_V1 = Buffer.alloc(32, 1).toString("base64");
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** FAKE overview — fictional trip, display names only. */
const FAKE_OVERVIEW = {
  block_key: "travel_overview" as const,
  title: "FAKE KL weekend",
  destinations: ["Kuala Lumpur"],
  start_date: "2027-01-10",
  end_date: "2027-01-14",
  companions: ["Alex", "Sam"],
  statuses: [
    { label: "flight", status: "已订" as const },
    { label: "hotel", status: "待订" as const },
  ],
};

/** FAKE transport leg — service number + ref_tail only. */
const FAKE_TRANSPORT = {
  block_key: "travel_transport" as const,
  legs: [
    {
      mode: "flight" as const,
      service_number: "SQ321",
      depart_at: "2027-01-10T08:30+08:00",
      depart_tz: "Asia/Singapore",
      arrive_at: "2027-01-10T09:35+08:00",
      arrive_tz: "Asia/Kuala_Lumpur",
      from_terminal: "T3",
      to_terminal: "T1",
      ref_tail: "7K",
      booked: true,
      check_in: "app",
      baggage: "1x32kg",
      status: "已订" as const,
    },
  ],
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

describe("travel block_key whitelist", () => {
  it("lists 9 base slots", () => {
    expect(TRAVEL_BLOCK_KEYS).toHaveLength(9);
    expect(TRAVEL_BLOCK_KEYS).toContain("travel_overview");
    expect(TRAVEL_BLOCK_KEYS).toContain("travel_packing_emergency");
  });

  it("parses base and trip-scoped keys; packing_emergency is one slot", () => {
    expect(parseTravelBlockKey("travel_overview")).toEqual({
      trip: undefined,
      slot: "overview",
      key: "travel_overview",
    });
    expect(parseTravelBlockKey("travel_kl2027_overview")).toEqual({
      trip: "kl2027",
      slot: "overview",
      key: "travel_kl2027_overview",
    });
    expect(parseTravelBlockKey("travel_kl2027_packing_emergency")?.slot).toBe(
      "packing_emergency",
    );
    expect(isTravelBlockKey("travel_unknown")).toBe(false);
    expect(isTravelBlockKey("bank_acc_hsbc")).toBe(false);
    expect(travelBlockKeyFor("budget", "penang")).toBe("travel_penang_budget");
  });

  it("rejects cross-category keys", () => {
    expect(isBlockKeyAllowedForCategory("travel", "cpf_acc_oa")).toBe(false);
    expect(isBlockKeyAllowedForCategory("travel", "bank_acc_hsbc")).toBe(false);
    expect(isBlockKeyAllowedForCategory("travel", "travel_overview")).toBe(
      true,
    );
    expect(
      isBlockKeyAllowedForCategory("travel", "travel_kl2027_stays"),
    ).toBe(true);
    expect(isBlockKeyAllowedForCategory("bank", "travel_overview")).toBe(
      false,
    );
    expect(isBlockKeyAllowedForCategory("cpf", "travel_overview")).toBe(false);
  });

  it("parseDashboardBlockPayload cross-rejects keys", () => {
    expect(
      parseDashboardBlockPayload("text", FAKE_OVERVIEW, "bank").ok,
    ).toBe(false);
    expect(
      parseDashboardBlockPayload("text", FAKE_OVERVIEW, "cpf").ok,
    ).toBe(false);
    expect(
      parseDashboardBlockPayload("text", FAKE_OVERVIEW, "travel").ok,
    ).toBe(true);
    expect(
      parseDashboardBlockPayload(
        "metric",
        { title: "OA", value: 1, unit: "S$", block_key: "cpf_acc_oa" },
        "travel",
      ).ok,
    ).toBe(false);
  });

  it("maps expected block_type per slot", () => {
    expect(expectedTravelBlockType("travel_overview")).toBe("text");
    expect(expectedTravelBlockType("travel_transport")).toBe("list");
    expect(expectedTravelBlockType("travel_budget")).toBe("text");
    expect(expectedTravelBlockType("travel_kl2027_candidates")).toBe("list");
  });
});

describe("travel strict schemas (FAKE)", () => {
  it("accepts FAKE overview / transport / budget", () => {
    expect(
      parseTravelBlockPayload("text", FAKE_OVERVIEW, "travel_overview").ok,
    ).toBe(true);
    expect(
      parseTravelBlockPayload("list", FAKE_TRANSPORT, "travel_transport").ok,
    ).toBe(true);
    expect(
      parseTravelBlockPayload(
        "text",
        {
          block_key: "travel_budget",
          estimate: 1200,
          actual: 350,
          currency: "MYR",
          per_person: 600,
        },
        "travel_budget",
      ).ok,
    ).toBe(true);
  });

  it("accepts trip-scoped key when payload matches", () => {
    const key = "travel_kl2027_overview";
    expect(
      parseTravelBlockPayload(
        "text",
        { ...FAKE_OVERVIEW, block_key: key },
        key,
      ).ok,
    ).toBe(true);
  });

  it("rejects wrong block_type, unknown fields, and end before start", () => {
    expect(
      parseTravelBlockPayload("list", FAKE_OVERVIEW, "travel_overview").ok,
    ).toBe(false);
    expect(
      parseTravelBlockPayload(
        "text",
        { ...FAKE_OVERVIEW, extra: 1 },
        "travel_overview",
      ).ok,
    ).toBe(false);
    expect(
      parseTravelBlockPayload(
        "text",
        { ...FAKE_OVERVIEW, end_date: "2027-01-01" },
        "travel_overview",
      ).ok,
    ).toBe(false);
  });

  it("rejects datetime without offset, invalid calendar, bad offset, invalid IANA tz", () => {
    const badTime = {
      ...FAKE_TRANSPORT,
      legs: [
        {
          ...FAKE_TRANSPORT.legs[0]!,
          depart_at: "2027-01-10T08:30:00",
        },
      ],
    };
    expect(
      parseTravelBlockPayload("list", badTime, "travel_transport").ok,
    ).toBe(false);

    const badCalendar = {
      ...FAKE_TRANSPORT,
      legs: [
        {
          ...FAKE_TRANSPORT.legs[0]!,
          depart_at: "2027-13-45T25:61+08:00",
        },
      ],
    };
    expect(
      parseTravelBlockPayload("list", badCalendar, "travel_transport").ok,
    ).toBe(false);

    const badOffset = {
      ...FAKE_TRANSPORT,
      legs: [
        {
          ...FAKE_TRANSPORT.legs[0]!,
          depart_at: "2027-01-10T08:30+99:99",
        },
      ],
    };
    expect(
      parseTravelBlockPayload("list", badOffset, "travel_transport").ok,
    ).toBe(false);

    const badTz = {
      ...FAKE_TRANSPORT,
      legs: [
        {
          ...FAKE_TRANSPORT.legs[0]!,
          depart_tz: "Not/A_Zone",
        },
      ],
    };
    expect(
      parseTravelBlockPayload("list", badTz, "travel_transport").ok,
    ).toBe(false);
  });

  it("rejects negative budget/candidate prices and url/javascript sources", () => {
    expect(
      parseTravelBlockPayload(
        "text",
        {
          block_key: "travel_budget",
          estimate: -1,
          currency: "MYR",
        },
        "travel_budget",
      ).ok,
    ).toBe(false);

    expect(
      parseTravelBlockPayload(
        "list",
        {
          block_key: "travel_candidates",
          flights: [
            {
              label: "FAKE",
              price: 10,
              currency: "SGD",
              source: "javascript:alert(1)",
            },
          ],
          hotels: [],
        },
        "travel_candidates",
      ).ok,
    ).toBe(false);

    expect(
      parseTravelBlockPayload(
        "list",
        {
          block_key: "travel_candidates",
          flights: [
            {
              label: "FAKE",
              price: 10,
              currency: "SGD",
              source: "fake-ota",
              notes: "https://example.com/deal",
            },
          ],
          hotels: [],
        },
        "travel_candidates",
      ).ok,
    ).toBe(false);
  });

  it("rejects ref_tail longer than 2 and documents with numbers", () => {
    const longRef = {
      ...FAKE_TRANSPORT,
      legs: [
        {
          ...FAKE_TRANSPORT.legs[0]!,
          ref_tail: "ABC",
        },
      ],
    };
    expect(
      parseTravelBlockPayload("list", longRef, "travel_transport").ok,
    ).toBe(false);

    expect(
      parseTravelBlockPayload(
        "list",
        {
          block_key: "travel_documents",
          items: [
            {
              kind: "passport",
              status: "已备",
              expiry_month: "2030-06",
              number: "E12345678",
            },
          ],
        },
        "travel_documents",
      ).ok,
    ).toBe(false);

    expect(
      parseTravelBlockPayload(
        "list",
        {
          block_key: "travel_documents",
          items: [
            { kind: "passport", status: "已备", expiry_month: "2030-06" },
            { kind: "e_arrival", label: "MDAC", status: "未备" },
          ],
        },
        "travel_documents",
      ).ok,
    ).toBe(true);
  });

  it("accepts stays / itinerary / todos / packing / candidates (FAKE)", () => {
    expect(
      parseTravelBlockPayload(
        "list",
        {
          block_key: "travel_stays",
          stays: [
            {
              name: "FAKE Hotel Riverview",
              address: "1 Fake Jalan, Kuala Lumpur",
              check_in_at: "2027-01-10T15:00+08:00",
              check_in_tz: "Asia/Kuala_Lumpur",
              check_out_at: "2027-01-14T12:00+08:00",
              check_out_tz: "Asia/Kuala_Lumpur",
              ref_tail: "Q2",
              free_cancellation: true,
              free_cancellation_until: "2027-01-08T23:59+08:00",
              status: "已订",
            },
          ],
        },
        "travel_stays",
      ).ok,
    ).toBe(true);

    expect(
      parseTravelBlockPayload(
        "list",
        {
          block_key: "travel_itinerary",
          days: [
            {
              date: "2027-01-11",
              items: [
                {
                  kind: "sight",
                  title: "FAKE Batu Caves",
                  at: "2027-01-11T09:00+08:00",
                  tz: "Asia/Kuala_Lumpur",
                  transit_note: "Grab ~40 min",
                },
              ],
            },
          ],
        },
        "travel_itinerary",
      ).ok,
    ).toBe(true);

    expect(
      parseTravelBlockPayload(
        "list",
        {
          block_key: "travel_todos",
          items: [
            {
              title: "FAKE online check-in",
              due: "2027-01-09",
              done: false,
              kind: "check_in",
            },
          ],
        },
        "travel_todos",
      ).ok,
    ).toBe(true);

    expect(
      parseTravelBlockPayload(
        "text",
        {
          block_key: "travel_packing_emergency",
          packing: [{ label: "charger", done: false }],
          emergency: [
            { label: "local emergency", phone: "999" },
            { label: "hotel desk", phone: "03-2141-0000" },
          ],
        },
        "travel_packing_emergency",
      ).ok,
    ).toBe(true);

    expect(
      parseTravelBlockPayload(
        "list",
        {
          block_key: "travel_candidates",
          flights: [
            {
              label: "FAKE morning flight",
              price: 180,
              currency: "SGD",
              source: "fake-ota",
              notes: "display only",
            },
          ],
          hotels: [
            {
              label: "FAKE central hotel",
              price: 90,
              currency: "MYR",
              source: "fake-ota",
            },
          ],
        },
        "travel_candidates",
      ).ok,
    ).toBe(true);
  });

  it("rejects phone with 9+ consecutive digits", () => {
    expect(
      parseTravelBlockPayload(
        "text",
        {
          block_key: "travel_packing_emergency",
          packing: [],
          emergency: [{ label: "desk", phone: "0321410000" }],
        },
        "travel_packing_emergency",
      ).ok,
    ).toBe(false);
  });
});

describe("travel privacy guard", () => {
  it("forbids booking / passport / password keys", () => {
    for (const key of [
      "passport",
      "passport_no",
      "booking_ref",
      "bookingRef",
      "pnr",
      "PNR",
      "confirmation_code",
      "password",
      "ticket_number",
      "cvv",
    ]) {
      expect(isForbiddenDashboardIdentifierKey(key)).toBe(true);
      expect(containsSingaporeNricOrFin({ [key]: "x" })).toBe(true);
    }
  });

  it("rejects full booking ref / passport-like / card-like values", () => {
    expect(stringIsFullBookingRef("ABC12X")).toBe(true);
    expect(stringIsFullBookingRef("abc12x")).toBe(true);
    expect(stringIsFullBookingRef("ABCDEF")).toBe(true);
    expect(stringIsFullBookingRef("travel")).toBe(false);
    expect(stringIsFullBookingRef("1x32kg")).toBe(false);
    expect(stringIsFullBookingRef("SQ321")).toBe(false);
    expect(stringIsFullBookingRef("7K")).toBe(false);
    expect(stringContainsPassportLike("E1234567A")).toBe(true);
    expect(stringContainsPassportLike("E-1234567-A")).toBe(true);
    expect(stringContainsPassportLike("E12345678")).toBe(false);
    expect(stringContainsLongDigitRun("4111111111111111")).toBe(true);
    expect(stringContainsSeparatedCardNumber("4111 1111 1111 1111")).toBe(
      true,
    );
    expect(stringContainsSeparatedCardNumber("4111-1111-1111-1111")).toBe(
      true,
    );

    // Entire-value booking ref is travel-only.
    expect(containsSingaporeNricOrFin({ note: "ABC12X" })).toBe(false);
    expect(
      containsSingaporeNricOrFin({ note: "ABC12X" }, { travel: true }),
    ).toBe(true);
    expect(
      containsSingaporeNricOrFin({ note: "E1234567A" }, { travel: true }),
    ).toBe(true);
    expect(containsSingaporeNricOrFin({ note: "4111111111111111" })).toBe(
      true,
    );
    expect(
      containsSingaporeNricOrFin({ note: "4111 1111 1111 1111" }),
    ).toBe(true);
    expect(
      containsSingaporeNricOrFin({ booking_ref: "SECRET1" }),
    ).toBe(true);
  });

  it("rejects booking refs embedded after keywords (FAKE tokens only)", () => {
    for (const note of [
      "PNR ABC123",
      "pnr: XYZ99A",
      "booking #AB12CD",
      "ref ABC12X",
      "reference: QWERTY1",
      "confirmation AB12CD",
      "订单号 ABC123",
      "订单 ABC12X",
      "确认码 XYZ99A",
      "预订号 AB12CD",
    ]) {
      expect(stringContainsBookingKeywordRef(note), note).toBe(true);
      expect(containsSingaporeNricOrFin({ note }), note).toBe(true);
    }
  });

  it("allows FAKE travel payloads through privacy walk", () => {
    expect(
      containsSingaporeNricOrFin(FAKE_OVERVIEW, { travel: true }),
    ).toBe(false);
    expect(
      containsSingaporeNricOrFin(FAKE_TRANSPORT, { travel: true }),
    ).toBe(false);
    for (const key of TRAVEL_BLOCK_KEYS) {
      expect(
        containsSingaporeNricOrFin({ block_key: key }, { travel: true }),
      ).toBe(false);
    }
    for (const key of [...BANK_BLOCK_KEYS, ...CPF_BLOCK_KEYS]) {
      expect(containsSingaporeNricOrFin({ block_key: key })).toBe(false);
    }
  });
});

describe("travel writers gate", () => {
  it("travel is never auto-backfilled", () => {
    expect(
      backfillDashboardWriters([
        { category: "travel", agent_id: AGENT_A },
        { category: "travel", agent_id: AGENT_B },
      ]),
    ).toEqual([]);
  });

  it("travel-only writer cannot write to bank (403)", async () => {
    vi.resetModules();
    setEnv();
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
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ travel: AGENT_A });
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
                      agent_id: AGENT_A,
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
    expect(res.status).toBe(403);
  });

  it("writer may create travel section; empty list → 403", async () => {
    for (const [agentId, writers, expected] of [
      [AGENT_A, { travel: AGENT_A }, 201],
      [AGENT_B, { travel: AGENT_A }, 403],
      [AGENT_A, {}, 403],
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
                        category: "travel",
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
          body: JSON.stringify({ category: "travel" }),
        }),
      );
      expect(res.status, `${agentId}`).toBe(expected);
    }
  });

  it("privacy hit on travel upsert → 400 without echoing content", async () => {
    vi.resetModules();
    setEnv();
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
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ travel: AGENT_A });
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: SECTION_ID,
                    category: "travel",
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
        rpc: async () => {
          throw new Error("rpc should not run");
        },
      }),
    }));
    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
      new Request(
        `http://localhost/api/agent/dashboard/sections/${SECTION_ID}/blocks/travel_overview`,
        {
          method: "PUT",
          headers: {
            authorization: "Bearer xjg_at_test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            block_type: "text",
            payload: {
              ...FAKE_OVERVIEW,
              note: "E1234567A",
            },
          }),
        },
      ),
      {
        params: Promise.resolve({
          id: SECTION_ID,
          block_key: "travel_overview",
        }),
      },
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: DASHBOARD_INVALID_PAYLOAD_ERROR,
    });
  });

  it("upsert creates travel block for writer (FAKE)", async () => {
    const enc = encryptBlockPayload(BLOCK_ID, FAKE_OVERVIEW);
    let rpcArgs: Record<string, unknown> | null = null;
    vi.resetModules();
    setEnv();
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
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ travel: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SECTION_ID,
                      category: "travel",
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
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
                is: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          };
        },
        rpc: async (name: string, args: Record<string, unknown>) => {
          expect(name).toBe("upsert_dashboard_block_by_key");
          rpcArgs = args;
          expect(args.p_block_key).toBe("travel_overview");
          const id = (args.p_id as string) ?? BLOCK_ID;
          return {
            data: {
              inserted: true,
              block: {
                id,
                section_id: SECTION_ID,
                block_type: "text",
                sort_order: 0,
                agent_id: AGENT_A,
                block_key: "travel_overview",
                payload:
                  typeof args.p_payload === "string" ? args.p_payload : enc,
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
        `http://localhost/api/agent/dashboard/sections/${SECTION_ID}/blocks/travel_overview`,
        {
          method: "PUT",
          headers: {
            authorization: "Bearer xjg_at_test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            block_type: "text",
            payload: FAKE_OVERVIEW,
          }),
        },
      ),
      {
        params: Promise.resolve({
          id: SECTION_ID,
          block_key: "travel_overview",
        }),
      },
    );
    expect(res.status).toBe(201);
    expect(rpcArgs).not.toBeNull();
    expect(rpcArgs!.p_block_key).toBe("travel_overview");
    const body = (await res.json()) as { block: { payload: unknown } };
    expect(body.block.payload).toMatchObject(FAKE_OVERVIEW);
  });
});

describe("travel write 400 issues (zod, no value echo)", () => {
  it("travel_overview with extra field → 400 issues path + unrecognized_keys", async () => {
    vi.resetModules();
    setEnv();
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
        from: (table: string) => {
          if (table === "dashboard_writers") {
            return mockDashboardWritersFrom({ travel: AGENT_A });
          }
          if (table === "dashboard_sections") {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: SECTION_ID,
                      category: "travel",
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
          throw new Error("should not reach blocks");
        },
      }),
    }));

    const SECRET_EXTRA = "TRAVEL_EXTRA_SECRET_VALUE";
    const { PUT } = await import(
      "@/app/api/agent/dashboard/sections/[id]/blocks/[block_key]/route"
    );
    const res = await PUT(
      new Request(
        `http://localhost/api/agent/dashboard/sections/${SECTION_ID}/blocks/travel_overview`,
        {
          method: "PUT",
          headers: {
            authorization: "Bearer xjg_at_test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            block_type: "text",
            payload: {
              ...FAKE_OVERVIEW,
              secret_note: SECRET_EXTRA,
            },
          }),
        },
      ),
      {
        params: Promise.resolve({
          id: SECTION_ID,
          block_key: "travel_overview",
        }),
      },
    );

    expect(res.status).toBe(400);
    const raw = await res.text();
    expect(raw).not.toContain(SECRET_EXTRA);
    const body = JSON.parse(raw) as {
      error: string;
      issues: Array<{ path: string; code: string; message: string }>;
    };
    expect(body.error).toBe(DASHBOARD_INVALID_PAYLOAD_ERROR);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(
      body.issues.some(
        (i) =>
          i.path === "secret_note" &&
          i.code === "unrecognized_keys" &&
          i.message === "多余字段",
      ),
    ).toBe(true);
  });
});
