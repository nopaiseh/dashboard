import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeContentHash } from "@/lib/content-hash";
import { planAgentPatch } from "@/lib/items-logic";
import type { ItemRow } from "@/lib/types";

function item(overrides: Partial<ItemRow> = {}): ItemRow {
  const kind = overrides.kind ?? "todo";
  const title = overrides.title ?? "t";
  const body = overrides.body ?? "b";
  const options = overrides.options ?? [];
  const source_url = overrides.source_url ?? null;
  const due_at = overrides.due_at ?? null;
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind,
    agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    project: "",
    title,
    body,
    options,
    due_at,
    source_url,
    status: overrides.status ?? "open",
    content_hash:
      overrides.content_hash ??
      computeContentHash({
        kind,
        title,
        body,
        options,
        source_url,
        due_at,
      }),
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    last_activity_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("agent PATCH API / concurrency", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    process.env.SESSION_SECRET = "test-session-secret-at-least-32-chars!!";
  });

  it("plans patch without writing stale status when only project changes", () => {
    const planned = planAgentPatch(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      item({ status: "open" }),
      { project: "x" },
    );
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(planned.plan.setStatus).toBe(false);
      expect(planned.plan.expectedStatus).toBe("open");
    }
  });

  it("returns 409 when RPC reports concurrent status conflict", async () => {
    const existing = item({ status: "open" });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "conflict: status or content changed" },
    });

    vi.doMock("@/lib/agent-service", () => ({
      resolveAgentFromRequest: async () => ({
        ok: true,
        agent: { agentId: existing.agent_id, tokenHash: "h" },
      }),
    }));

    vi.doMock("@/lib/supabase/server", () => ({
      getServiceClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: existing, error: null }),
            }),
          }),
        }),
        rpc,
      }),
    }));

    const { PATCH } = await import("@/app/api/agent/items/[id]/route");
    const res = await PATCH(
      new Request(
        "http://localhost/api/agent/items/11111111-1111-4111-8111-111111111111",
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer tok",
          },
          body: JSON.stringify({ title: "new" }),
        },
      ),
      {
        params: Promise.resolve({
          id: "11111111-1111-4111-8111-111111111111",
        }),
      },
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("conflict");
    expect(rpc).toHaveBeenCalledWith(
      "apply_agent_item_patch",
      expect.objectContaining({
        p_expected_status: "open",
        p_set_status: true,
        p_new_status: "open",
      }),
    );
  });
});
