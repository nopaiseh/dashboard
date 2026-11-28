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
    result_read_at: null,
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

  it("keeps hash stable when DB returns due_at as +00:00", () => {
    const created = item({
      due_at: "2026-06-15T12:00:00.000Z",
      status: "approved",
    });
    // 模拟 PostgREST 读回 timestamptz
    const fromDb = item({
      ...created,
      due_at: "2026-06-15T12:00:00.000+00:00",
      content_hash: created.content_hash,
      status: "approved",
    });
    const planned = planAgentPatch(fromDb.agent_id, fromDb, {
      project: "same-content",
    });
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(planned.plan.contentReopened).toBe(false);
      expect(planned.plan.setStatus).toBe(false);
      expect(planned.plan.newContentHash).toBe(created.content_hash);
    }
  });

  it("rejects content change combined with withdrawn", () => {
    const planned = planAgentPatch(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      item({ status: "open", kind: "approval" }),
      { title: "new", status: "withdrawn" },
    );
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.status).toBe(400);
    }
  });

  it("status-only patch keeps stale content_hash after kind migration", () => {
    // 模拟迁移后：kind 已是 todo，但 content_hash 仍按旧 question_to_user 计算
    const staleHash = computeContentHash({
      kind: "question_to_user",
      title: "t",
      body: "b",
      options: [],
      source_url: null,
      due_at: null,
    });
    const migrated = item({
      kind: "todo",
      title: "t",
      body: "b",
      content_hash: staleHash,
      status: "open",
    });
    const planned = planAgentPatch(migrated.agent_id, migrated, {
      status: "done",
    });
    expect(planned.ok).toBe(true);
    if (planned.ok) {
      expect(planned.plan.contentReopened).toBe(false);
      expect(planned.plan.setStatus).toBe(true);
      expect(planned.plan.newStatus).toBe("done");
      expect(planned.plan.newContentHash).toBe(staleHash);
    }
  });

  it("returns 422 when item sensitive fields cannot be decrypted", async () => {
    const existing = item({ status: "open" });
    const otherId = "22222222-2222-4222-8222-222222222222";
    const { encryptItemSensitiveFields } = await import("@/lib/crypto/fields");
    const sealed = encryptItemSensitiveFields({
      id: otherId,
      title: existing.title,
      body: existing.body,
      source_url: existing.source_url,
    });
    // Ciphertext bound to otherId → decrypt for existing.id fails.
    const broken = {
      ...existing,
      title: sealed.title,
      body: sealed.body,
      source_url: sealed.source_url,
    };

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
              maybeSingle: async () => ({ data: broken, error: null }),
            }),
          }),
        }),
        rpc: vi.fn(),
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
          body: JSON.stringify({ project: "x" }),
        },
      ),
      {
        params: Promise.resolve({
          id: "11111111-1111-4111-8111-111111111111",
        }),
      },
    );

    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/could not be decrypted/i);
  });

  it("returns 409 when RPC reports concurrent status conflict", async () => {
    const existing = item({ status: "open" });
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "XJ409", message: "conflict: status or content changed" },
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
