import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BANK_LEDGER_MONTH_JSON_MAX } from "@/lib/dashboard/bank-validation";
import {
  containsSingaporeNricOrFin,
  isForbiddenDashboardIdentifierKey,
  MAX_BANK_LEDGER_EMBEDDED_JSON_STRING_LENGTH,
  MAX_EMBEDDED_JSON_DEPTH,
  MAX_EMBEDDED_JSON_STRING_LENGTH,
  normalizeForNricScan,
  stringContainsSingaporeNricOrFin,
} from "@/lib/dashboard/nric-guard";
import { DASHBOARD_INVALID_PAYLOAD_ERROR } from "@/lib/dashboard/write-errors";

const SAMPLE_NRIC = "S1234567A";
const SAMPLE_FIN = "G7654321B";
const IDENTICAL_ERROR_BODY = { error: DASHBOARD_INVALID_PAYLOAD_ERROR };

describe("forbidden identifier key names", () => {
  it("blocks nric / fin / cpf_account / account_no / account_number / nric_number / card / iban variants at any depth", () => {
    for (const key of [
      "nric",
      "NRIC",
      "fin",
      "FIN",
      "cpf_account",
      "cpfAccount",
      "CPF_ACCOUNT",
      "account_no",
      "accountNo",
      "cpf_account_no",
      "cpfAccountNo",
      "account_number",
      "accountNumber",
      "ACCOUNT_NUMBER",
      "nric_number",
      "nricNumber",
      "NRIC_NUMBER",
      "card_no",
      "cardNo",
      "card_number",
      "cardNumber",
      "last4",
      "iban",
      "IBAN",
      "swift",
      "SWIFT",
      "pan",
      "PAN",
      "passport",
      "passport_no",
      "booking_ref",
      "pnr",
      "password",
      "confirmation_code",
      "ticket_number",
      "cvv",
    ]) {
      expect(isForbiddenDashboardIdentifierKey(key)).toBe(true);
      expect(containsSingaporeNricOrFin({ [key]: "x" })).toBe(true);
      expect(
        containsSingaporeNricOrFin({ payload: { nested: { [key]: 1 } } }),
      ).toBe(true);
    }
  });

  it("allows unrelated keys including final / fine (exact match after normalize)", () => {
    expect(isForbiddenDashboardIdentifierKey("title")).toBe(false);
    expect(isForbiddenDashboardIdentifierKey("account_name")).toBe(false);
    expect(isForbiddenDashboardIdentifierKey("final")).toBe(false);
    expect(isForbiddenDashboardIdentifierKey("fine")).toBe(false);
    expect(isForbiddenDashboardIdentifierKey("Final")).toBe(false);
    expect(isForbiddenDashboardIdentifierKey("FINE")).toBe(false);
    expect(containsSingaporeNricOrFin({ title: "OA", value: 1 })).toBe(false);
    expect(
      containsSingaporeNricOrFin({
        payload: { nested: { final: true, fine: 0.5 } },
      }),
    ).toBe(false);
  });
});

describe("NRIC separator bypass", () => {
  it("normalizes whitespace / hyphen / dot / underscore / comma / slash away", () => {
    expect(normalizeForNricScan("S-1234567-A")).toBe("S1234567A");
    expect(normalizeForNricScan("S 1234567 A")).toBe("S1234567A");
    expect(normalizeForNricScan("S_1234567_A")).toBe("S1234567A");
    expect(normalizeForNricScan("S.1234567.A")).toBe("S1234567A");
    expect(normalizeForNricScan("S/1234567/A")).toBe("S1234567A");
    expect(normalizeForNricScan("S,1234567,A")).toBe("S1234567A");
  });

  it("rejects NRIC with separators", () => {
    expect(stringContainsSingaporeNricOrFin("S-1234567-A")).toBe(true);
    expect(stringContainsSingaporeNricOrFin("S 1234567 A")).toBe(true);
    expect(stringContainsSingaporeNricOrFin("G_7654321_B")).toBe(true);
    expect(stringContainsSingaporeNricOrFin("id: S.1234567.A")).toBe(true);
    expect(stringContainsSingaporeNricOrFin("S,1234567,A")).toBe(true);
    expect(
      containsSingaporeNricOrFin({ text: `acct ${SAMPLE_NRIC.slice(0, 1)}-${SAMPLE_NRIC.slice(1, 8)}-${SAMPLE_NRIC.slice(8)}` }),
    ).toBe(true);
    expect(
      containsSingaporeNricOrFin({ text: "S,1234567,A" }),
    ).toBe(true);
  });

  it("does not falsely reject currency, years, or ordinary text", () => {
    expect(stringContainsSingaporeNricOrFin("S$1234")).toBe(false);
    expect(stringContainsSingaporeNricOrFin("S$12,345.67")).toBe(false);
    expect(stringContainsSingaporeNricOrFin("2024")).toBe(false);
    expect(stringContainsSingaporeNricOrFin("2016-2026")).toBe(false);
    expect(stringContainsSingaporeNricOrFin("version 1.2.3")).toBe(false);
    expect(containsSingaporeNricOrFin({ year: 2025, unit: "SGD" })).toBe(
      false,
    );
    expect(
      containsSingaporeNricOrFin({
        text: "余额 S$1234 · 年份 2024",
        missing_years: [2019, 2020],
      }),
    ).toBe(false);
  });

  it("rejects 9+ consecutive digits in strings (not numbers)", async () => {
    const { stringContainsLongDigitRun } = await import(
      "@/lib/dashboard/nric-guard"
    );
    expect(stringContainsLongDigitRun("12345678")).toBe(false);
    expect(stringContainsLongDigitRun("123456789")).toBe(true);
    expect(containsSingaporeNricOrFin({ note: "FAKE ref 1234567890" })).toBe(
      true,
    );
    // Numeric amounts are not scanned as digit runs (CPF-safe).
    expect(containsSingaporeNricOrFin({ value: 12_345_678 })).toBe(false);
    // UUID section/block ids must not trip the digit-run check.
    expect(
      containsSingaporeNricOrFin({
        section_id: "11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(false);
  });
});

describe("containsSingaporeNricOrFin (value regex)", () => {
  it("rejects NRIC/FIN at top-level strings", () => {
    expect(containsSingaporeNricOrFin(SAMPLE_NRIC)).toBe(true);
    expect(containsSingaporeNricOrFin(`id ${SAMPLE_FIN}`)).toBe(true);
    expect(containsSingaporeNricOrFin("s1234567a")).toBe(true);
    expect(containsSingaporeNricOrFin("T1111111H")).toBe(true);
    expect(containsSingaporeNricOrFin("F2222222K")).toBe(true);
    expect(containsSingaporeNricOrFin("M3333333L")).toBe(true);
  });

  it("rejects NRIC nested in objects and arrays", () => {
    expect(
      containsSingaporeNricOrFin({
        payload: { title: `account ${SAMPLE_NRIC}` },
      }),
    ).toBe(true);
    expect(
      containsSingaporeNricOrFin({
        items: ["ok", SAMPLE_FIN, "also"],
      }),
    ).toBe(true);
    expect(
      containsSingaporeNricOrFin({
        series: [{ t: "2026-01", v: 1, label: SAMPLE_NRIC }],
      }),
    ).toBe(true);
  });

  it("rejects NRIC when used as an object key", () => {
    expect(containsSingaporeNricOrFin({ [SAMPLE_NRIC]: "value" })).toBe(true);
    expect(
      containsSingaporeNricOrFin({ payload: { [SAMPLE_FIN]: 1 } }),
    ).toBe(true);
  });
});

describe("embedded JSON string unwrapping", () => {
  it("rejects banned keys inside JSON string values (case / separator variants)", () => {
    for (const json of [
      '{"nric":"x"}',
      '{"NRIC":"x"}',
      '{"accountNo":"1"}',
      '{"account_no":"1"}',
      '{"cpfAccount":"x"}',
      '{"cpf-account":"x"}',
      '{"account_number":"x"}',
      '{"nric_number":"x"}',
      '  {"fin":"y"}  ',
    ]) {
      expect(containsSingaporeNricOrFin({ items: [json] }), json).toBe(true);
      expect(containsSingaporeNricOrFin({ text: json }), json).toBe(true);
    }
  });

  it("rejects banned keys nested two JSON-string levels deep", () => {
    const inner = JSON.stringify({ nric: "x" });
    const outer = JSON.stringify({ wrapper: inner });
    expect(containsSingaporeNricOrFin({ items: [outer] })).toBe(true);

    const innerAccount = JSON.stringify({ accountNo: "1" });
    const mid = JSON.stringify({ payload: innerAccount });
    expect(containsSingaporeNricOrFin({ text: mid })).toBe(true);
  });

  it("allows clean JSON strings and non-JSON strings", () => {
    expect(
      containsSingaporeNricOrFin({
        items: ['{"title":"OA","value":1}', '{"note":"ok"}'],
      }),
    ).toBe(false);
    expect(
      containsSingaporeNricOrFin({
        text: "普通说明，无证件号",
        items: ["todo: 核对余额", "{ not json", "[ unfinished"],
      }),
    ).toBe(false);
    expect(containsSingaporeNricOrFin({ items: ["[1,2,3]"] })).toBe(false);
  });

  it("still rejects NRIC values that appear only inside JSON string text", () => {
    expect(
      containsSingaporeNricOrFin({
        items: [JSON.stringify({ note: SAMPLE_NRIC })],
      }),
    ).toBe(true);
  });

  it("fail-closes when JSON-looking nesting exceeds the depth cap", () => {
    // Innermost is a JSON string; each wrap adds one unwrap. Exactly MAX
    // unwraps reaches { ok: true }; MAX+1 fail-closes.
    let nested = JSON.stringify({ ok: true });
    for (let i = 1; i < MAX_EMBEDDED_JSON_DEPTH; i++) {
      nested = JSON.stringify({ w: nested });
    }
    expect(containsSingaporeNricOrFin({ text: nested })).toBe(false);

    const tooDeep = JSON.stringify({ w: nested });
    expect(containsSingaporeNricOrFin({ text: tooDeep })).toBe(true);
    expect(containsSingaporeNricOrFin({ items: [tooDeep] })).toBe(true);
  });

  it("fail-closes when a JSON-looking string exceeds the size cap", () => {
    const oversized = `{${"a".repeat(MAX_EMBEDDED_JSON_STRING_LENGTH)}}`;
    expect(oversized.length).toBeGreaterThan(MAX_EMBEDDED_JSON_STRING_LENGTH);
    expect(containsSingaporeNricOrFin({ text: oversized })).toBe(true);
    expect(containsSingaporeNricOrFin({ items: [oversized] })).toBe(true);
  });

  it("raises unwrap cap for bank_ledger months to 32k and still scans content", () => {
    expect(MAX_BANK_LEDGER_EMBEDDED_JSON_STRING_LENGTH).toBe(
      BANK_LEDGER_MONTH_JSON_MAX,
    );
    const lines = Array.from({ length: 200 }, (_, i) => ({
      kind: i % 2 === 0 ? ("in" as const) : ("out" as const),
      category: "subscription" as const,
      amount: 1000 + i,
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
    expect(month.length).toBeGreaterThan(MAX_EMBEDDED_JSON_STRING_LENGTH);
    expect(month.length).toBeLessThanOrEqual(
      MAX_BANK_LEDGER_EMBEDDED_JSON_STRING_LENGTH,
    );
    expect(
      containsSingaporeNricOrFin({
        block_key: "bank_ledger",
        items: [month],
      }),
    ).toBe(false);
    // Non-ledger context still uses the 10k cap.
    expect(containsSingaporeNricOrFin({ items: [month] })).toBe(true);

    const overLedger = `{${"a".repeat(MAX_BANK_LEDGER_EMBEDDED_JSON_STRING_LENGTH)}}`;
    expect(
      containsSingaporeNricOrFin({
        block_key: "bank_ledger",
        items: [overLedger],
      }),
    ).toBe(true);

    // Still scans full content under the raised cap (NRIC hit).
    const withNric = JSON.stringify({
      month: "2026-11",
      in_total: 1,
      out_total: 0,
      lines: [{ kind: "in", category: "other", amount: 1 }],
      note: `FAKE ${SAMPLE_NRIC}`,
      pad: "x".repeat(MAX_EMBEDDED_JSON_STRING_LENGTH),
    });
    expect(withNric.length).toBeGreaterThan(MAX_EMBEDDED_JSON_STRING_LENGTH);
    expect(withNric.length).toBeLessThanOrEqual(
      MAX_BANK_LEDGER_EMBEDDED_JSON_STRING_LENGTH,
    );
    expect(
      containsSingaporeNricOrFin({
        block_key: "bank_ledger",
        items: [withNric],
      }),
    ).toBe(true);
  });
});

describe("dashboard write routes: identical invalid payload bodies", () => {
  const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SECTION_ID = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  function mockAgentAuth() {
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
        from: () => {
          throw new Error("should not reach db");
        },
        rpc: () => {
          throw new Error("should not reach rpc");
        },
      }),
    }));
  }

  it("NRIC value, banned key, and section NRIC share one body without echo", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAgentAuth();

    const { POST: postBlock } = await import(
      "@/app/api/agent/dashboard/blocks/route"
    );

    const nricRes = await postBlock(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "text",
          payload: { text: `NRIC ${SAMPLE_NRIC}` },
        }),
      }),
    );

    vi.resetModules();
    mockAgentAuth();
    const { POST: postBlock2 } = await import(
      "@/app/api/agent/dashboard/blocks/route"
    );
    const bannedKeyRes = await postBlock2(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "metric",
          payload: { title: "OA", value: 1, cpfAccount: "x" },
        }),
      }),
    );

    vi.resetModules();
    mockAgentAuth();
    const { POST: postSection } = await import(
      "@/app/api/agent/dashboard/sections/route"
    );
    const sectionRes = await postSection(
      new Request("http://localhost/api/agent/dashboard/sections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: SAMPLE_FIN }),
      }),
    );

    const bodies = await Promise.all([
      nricRes.json(),
      bannedKeyRes.json(),
      sectionRes.json(),
    ]);

    for (const res of [nricRes, bannedKeyRes, sectionRes]) {
      expect(res.status).toBe(400);
    }
    for (const body of bodies) {
      expect(body).toEqual(IDENTICAL_ERROR_BODY);
      expect(body).not.toHaveProperty("details");
      expect(body).not.toHaveProperty("issues");
      expect(JSON.stringify(body)).not.toContain(SAMPLE_NRIC);
      expect(JSON.stringify(body)).not.toContain(SAMPLE_FIN);
      expect(JSON.stringify(body)).not.toContain("cpfAccount");
    }

    // No rejection logging (reason distinction removed).
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("zod schema failure returns issues but never echoes submitted values", async () => {
    mockAgentAuth();
    const { POST: postBlock } = await import(
      "@/app/api/agent/dashboard/blocks/route"
    );
    const schemaRes = await postBlock(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "metric",
          payload: { title: "OA", value: 1, unexpected_field: "secret-leak" },
        }),
      }),
    );

    expect(schemaRes.status).toBe(400);
    const body = await schemaRes.json();
    expect(body.error).toBe(DASHBOARD_INVALID_PAYLOAD_ERROR);
    expect(Array.isArray(body.issues)).toBe(true);
    expect(
      body.issues.some(
        (i: { path: string; code: string; message: string }) =>
          i.path === "unexpected_field" &&
          i.code === "unrecognized_keys" &&
          i.message === "多余字段",
      ),
    ).toBe(true);
    expect(JSON.stringify(body)).not.toContain("secret-leak");
  });

  it("PATCH rejects separator-obfuscated NRIC with the same body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockAgentAuth();

    const { PATCH } = await import(
      "@/app/api/agent/dashboard/blocks/[id]/route"
    );
    const res = await PATCH(
      new Request("http://localhost/api/agent/dashboard/blocks/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload: { text: "S-1234567-A" },
        }),
      }),
      { params: Promise.resolve({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }) },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(IDENTICAL_ERROR_BODY);
  });

  it("rejects account_number / nric_number keys and comma-separated NRIC with the same body", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockAgentAuth();

    const { POST: postBlock } = await import(
      "@/app/api/agent/dashboard/blocks/route"
    );
    const accountNumberRes = await postBlock(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "metric",
          payload: { title: "OA", value: 1, accountNumber: "x" },
        }),
      }),
    );

    vi.resetModules();
    mockAgentAuth();
    const { POST: postBlock2 } = await import(
      "@/app/api/agent/dashboard/blocks/route"
    );
    const nricNumberRes = await postBlock2(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "text",
          payload: { nested: { nric_number: "x" } },
        }),
      }),
    );

    vi.resetModules();
    mockAgentAuth();
    const { POST: postBlock3 } = await import(
      "@/app/api/agent/dashboard/blocks/route"
    );
    const commaNricRes = await postBlock3(
      new Request("http://localhost/api/agent/dashboard/blocks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_id: SECTION_ID,
          block_type: "text",
          payload: { text: "S,1234567,A" },
        }),
      }),
    );

    for (const res of [accountNumberRes, nricNumberRes, commaNricRes]) {
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(IDENTICAL_ERROR_BODY);
    }
  });

  it("rejects list items whose JSON string hides a banned key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    async function postListItems(items: string[]) {
      mockAgentAuth();
      const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
      return POST(
        new Request("http://localhost/api/agent/dashboard/blocks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            section_id: SECTION_ID,
            block_type: "list",
            payload: { items },
          }),
        }),
      );
    }

    for (const items of [
      ['{"nric":"x"}'],
      ['{"accountNo":"1"}'],
      ['{"NRIC":"x"}'],
      ['{"account_no":"1"}'],
      [JSON.stringify({ wrapper: JSON.stringify({ cpf_account: "x" }) })],
    ]) {
      vi.resetModules();
      const res = await postListItems(items);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(IDENTICAL_ERROR_BODY);
    }
  });

  it("returns 400 when embedded JSON exceeds depth or size caps", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    async function postText(text: string) {
      mockAgentAuth();
      const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
      return POST(
        new Request("http://localhost/api/agent/dashboard/blocks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            section_id: SECTION_ID,
            block_type: "text",
            payload: { text },
          }),
        }),
      );
    }

    let nested = JSON.stringify({ ok: true });
    for (let i = 1; i < MAX_EMBEDDED_JSON_DEPTH; i++) {
      nested = JSON.stringify({ w: nested });
    }
    const tooDeep = JSON.stringify({ w: nested });
    const depthRes = await postText(tooDeep);
    expect(depthRes.status).toBe(400);
    expect(await depthRes.json()).toEqual(IDENTICAL_ERROR_BODY);

    vi.resetModules();
    const oversized = `{${"a".repeat(MAX_EMBEDDED_JSON_STRING_LENGTH)}}`;
    const sizeRes = await postText(oversized);
    expect(sizeRes.status).toBe(400);
    expect(await sizeRes.json()).toEqual(IDENTICAL_ERROR_BODY);
  });
});
