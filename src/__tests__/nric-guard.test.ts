import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  containsSingaporeNricOrFin,
  isForbiddenDashboardIdentifierKey,
} from "@/lib/dashboard/nric-guard";
import { DASHBOARD_INVALID_PAYLOAD_ERROR } from "@/lib/dashboard/write-errors";

const SAMPLE_NRIC = "S1234567A";
const SAMPLE_FIN = "G7654321B";

describe("forbidden identifier key names", () => {
  it("blocks nric / fin / cpf_account / account_no variants", () => {
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
    ]) {
      expect(isForbiddenDashboardIdentifierKey(key)).toBe(true);
      expect(containsSingaporeNricOrFin({ [key]: "x" })).toBe(true);
      expect(
        containsSingaporeNricOrFin({ payload: { nested: { [key]: 1 } } }),
      ).toBe(true);
    }
  });

  it("allows unrelated keys", () => {
    expect(isForbiddenDashboardIdentifierKey("title")).toBe(false);
    expect(isForbiddenDashboardIdentifierKey("account_name")).toBe(false);
    expect(containsSingaporeNricOrFin({ title: "OA", value: 1 })).toBe(false);
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

  it("rejects NRIC nested in objects and arrays (titles, labels, items)", () => {
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
    expect(
      containsSingaporeNricOrFin({
        text: `body mentions ${SAMPLE_NRIC}`,
      }),
    ).toBe(true);
  });

  it("rejects NRIC when used as an object key", () => {
    expect(
      containsSingaporeNricOrFin({
        [SAMPLE_NRIC]: "value",
      }),
    ).toBe(true);
    expect(
      containsSingaporeNricOrFin({
        payload: { [SAMPLE_FIN]: 1 },
      }),
    ).toBe(true);
  });

  it("does not falsely reject currency or years", () => {
    expect(containsSingaporeNricOrFin("S$1234")).toBe(false);
    expect(containsSingaporeNricOrFin("S$12,345.67")).toBe(false);
    expect(containsSingaporeNricOrFin("2024")).toBe(false);
    expect(containsSingaporeNricOrFin("2016-2026")).toBe(false);
    expect(containsSingaporeNricOrFin({ year: 2025, unit: "SGD" })).toBe(
      false,
    );
    expect(
      containsSingaporeNricOrFin({
        text: "余额 S$1234 · 年份 2024",
        missing_years: ["2019", "2020"],
      }),
    ).toBe(false);
  });
});

describe("dashboard write routes reject with generic invalid payload", () => {
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

  it("POST /blocks NRIC → 400 { error: 'invalid payload' }, no leak in logs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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

    const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
    const res = await POST(
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

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: DASHBOARD_INVALID_PAYLOAD_ERROR });
    expect(JSON.stringify(body)).not.toContain(SAMPLE_NRIC);

    expect(errorSpy).toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(SAMPLE_NRIC);
      expect(serialized).not.toContain("NRIC");
      expect(serialized).toContain("invalid_payload");
    }
  });

  it("POST /blocks forbidden key name → same generic error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
      }),
    }));

    const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
    const res = await POST(
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

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: DASHBOARD_INVALID_PAYLOAD_ERROR,
    });
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("cpfAccount");
    }
  });

  it("POST /blocks schema failure → generic invalid payload (no details)", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
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
      }),
    }));

    const { POST } = await import("@/app/api/agent/dashboard/blocks/route");
    const res = await POST(
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

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: DASHBOARD_INVALID_PAYLOAD_ERROR });
    expect(body).not.toHaveProperty("details");
    expect(JSON.stringify(body)).not.toContain("secret-leak");
    expect(JSON.stringify(body)).not.toContain("unexpected_field");
    for (const call of errorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("secret-leak");
    }
  });

  it("PATCH /blocks rejects NRIC in object keys with generic error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      }),
    }));

    const { PATCH } = await import(
      "@/app/api/agent/dashboard/blocks/[id]/route"
    );
    const res = await PATCH(
      new Request("http://localhost/api/agent/dashboard/blocks/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payload: { [SAMPLE_NRIC]: "secret" },
        }),
      }),
      { params: Promise.resolve({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }) },
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: DASHBOARD_INVALID_PAYLOAD_ERROR,
    });
  });

  it("POST /sections rejects NRIC in category with generic error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
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
      }),
    }));

    const { POST } = await import("@/app/api/agent/dashboard/sections/route");
    const res = await POST(
      new Request("http://localhost/api/agent/dashboard/sections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: SAMPLE_FIN }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: DASHBOARD_INVALID_PAYLOAD_ERROR,
    });
  });
});
