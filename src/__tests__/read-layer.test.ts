import { beforeEach, describe, expect, it, vi } from "vitest";
import { heldCutoffIso, isHeldItem } from "@/lib/read/held";
import { hasInvalidatedApproval } from "@/lib/read/invalidation";
import { isValidUuid } from "@/lib/read/ids";

describe("read held helpers", () => {
  it("marks open items idle for 7+ days as held", () => {
    const now = new Date("2026-11-26T12:00:00.000Z");
    expect(isHeldItem("open", "2026-11-18T00:00:00.000Z", now)).toBe(true);
    expect(isHeldItem("open", "2026-11-25T00:00:00.000Z", now)).toBe(false);
    expect(isHeldItem("approved", "2026-11-01T00:00:00.000Z", now)).toBe(
      false,
    );
    expect(heldCutoffIso(now)).toBe("2026-11-19T12:00:00.000Z");
  });
});

describe("read invalidation", () => {
  it("detects stale approve events against current content_hash", () => {
    expect(
      hasInvalidatedApproval(
        { status: "open", kind: "approval", content_hash: "aaa" },
        [{ action: "approve", content_hash: "bbb" }],
      ),
    ).toBe(true);
    expect(
      hasInvalidatedApproval(
        { status: "open", kind: "approval", content_hash: "aaa" },
        [{ action: "approve", content_hash: "aaa" }],
      ),
    ).toBe(false);
  });
});

describe("read ids", () => {
  it("validates uuid", () => {
    expect(isValidUuid("22222222-2222-4222-8222-222222222222")).toBe(true);
    expect(isValidUuid("not-a-uuid")).toBe(false);
  });
});

describe("read data layer", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
  });

  it("throws DataReadError when item_events invalidation query fails (fail closed)", async () => {
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));

    const rows = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        kind: "approval",
        agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        project: "",
        title: "t",
        body: "",
        options: [],
        due_at: null,
        source_url: null,
        status: "open",
        content_hash: "aaa",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        last_activity_at: "2026-01-01T00:00:00.000Z",
        result_read_at: null,
      },
    ];
    const terminal = {
      order: async () => ({ data: rows, error: null }),
    };
    const from = vi.fn((table: string) => {
      if (table === "items") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => terminal,
              order: terminal.order,
            }),
          }),
        };
      }
      if (table === "agents") {
        return {
          select: async () => ({
            data: [
              {
                id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                slug: "a",
                name: "A",
                area: "",
                bot_id: null,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
            error: null,
          }),
        };
      }
      if (table === "item_events") {
        return {
          select: () => ({
            in: () => ({
              eq: async () => ({
                data: null,
                error: { message: "connection refused" },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({ from }),
    }));

    const { loadItemsByKind } = await import("@/lib/read/data");
    const { DataReadError } = await import("@/lib/read/errors");

    await expect(loadItemsByKind("approval", "open")).rejects.toBeInstanceOf(
      DataReadError,
    );
  });

  it("throws DataReadError when items query returns error (not empty list)", async () => {
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            order: async () => ({
              data: null,
              error: { message: "permission denied" },
            }),
          }),
        }),
      }),
    }));

    const { loadAllItems } = await import("@/lib/read/data");
    const { DataReadError } = await import("@/lib/read/errors");
    await expect(loadAllItems()).rejects.toBeInstanceOf(DataReadError);
  });

  it("returns null for invalid uuid in loadItemDetail (not found)", async () => {
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => {
          throw new Error("should not query db for invalid uuid");
        },
      }),
    }));

    const { loadItemDetail } = await import("@/lib/read/data");
    await expect(loadItemDetail("not-a-uuid")).resolves.toBeNull();
  });

  it("requires session before reading", async () => {
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({
        ok: false,
        status: 401,
        error: "unauthorized",
      }),
    }));
    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => {
          throw new Error("should not query without session");
        },
      }),
    }));

    const { loadAgents } = await import("@/lib/read/data");
    const { SessionRequiredError } = await import("@/lib/read/errors");
    await expect(loadAgents()).rejects.toBeInstanceOf(SessionRequiredError);
  });

  it("loadItemDetail never selects credential_id from item_events", async () => {
    vi.doMock("@/lib/auth-guard", () => ({
      requireSession: async () => ({ ok: true }),
    }));

    const eventSelect = vi.fn(() => ({
      eq: () => ({
        order: async () => ({ data: [], error: null }),
      }),
    }));

    const from = vi.fn((table: string) => {
      if (table === "items") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: "22222222-2222-4222-8222-222222222222",
                  kind: "todo",
                  agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                  project: "",
                  title: "t",
                  body: "",
                  options: [],
                  due_at: null,
                  source_url: null,
                  status: "open",
                  content_hash: "aaa",
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-01T00:00:00.000Z",
                  last_activity_at: "2026-01-01T00:00:00.000Z",
                  result_read_at: null,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "agents") {
        return {
          select: async () => ({
            data: [
              {
                id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                slug: "a",
                name: "A",
                area: "",
                bot_id: null,
                created_at: "2026-01-01T00:00:00.000Z",
              },
            ],
            error: null,
          }),
        };
      }
      if (table === "item_events") {
        return { select: eventSelect };
      }
      throw new Error(`unexpected table ${table}`);
    });

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({ from }),
    }));

    const { loadItemDetail } = await import("@/lib/read/data");
    const detail = await loadItemDetail(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(detail).not.toBeNull();
    expect(eventSelect).toHaveBeenCalled();
    const firstCall = eventSelect.mock.calls[0] as unknown[] | undefined;
    const cols = String(firstCall?.[0] ?? "");
    expect(cols).not.toContain("credential_id");
    expect(cols).not.toBe("*");
  });
});
