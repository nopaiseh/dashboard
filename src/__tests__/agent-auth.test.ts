import { describe, expect, it } from "vitest";
import {
  assertAgentMaySetStatus,
  assertAgentOwnsItem,
  authenticateAgentToken,
  extractBearerToken,
} from "@/lib/agent-auth";
import { computeContentHash } from "@/lib/content-hash";
import { hashAgentToken } from "@/lib/crypto";
import { planAgentPatch } from "@/lib/items-logic";
import type { ItemRow } from "@/lib/types";

function sampleItem(overrides: Partial<ItemRow> = {}): ItemRow {
  const title = overrides.title ?? "title";
  const body = overrides.body ?? "body";
  const options = overrides.options ?? [{ key: "a", label: "A" }];
  const kind = overrides.kind ?? "approval";
  const source_url = overrides.source_url ?? null;
  const due_at = overrides.due_at ?? null;
  const base: ItemRow = {
    id: "11111111-1111-4111-8111-111111111111",
    kind,
    agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    project: "p",
    title,
    body,
    options,
    due_at,
    source_url,
    status: "open",
    content_hash: computeContentHash({
      kind,
      title,
      body,
      options,
      source_url,
      due_at,
    }),
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    last_activity_at: "2025-01-01T00:00:00.000Z",
    result_read_at: null,
  };
  return {
    ...base,
    ...overrides,
    content_hash:
      overrides.content_hash ??
      computeContentHash({
        kind: overrides.kind ?? base.kind,
        title: overrides.title ?? base.title,
        body: overrides.body ?? base.body,
        options: overrides.options ?? base.options,
        source_url: overrides.source_url ?? base.source_url,
        due_at: overrides.due_at ?? base.due_at,
      }),
  };
}

describe("agent auth", () => {
  it("extracts bearer token", () => {
    expect(extractBearerToken("Bearer tok")).toBe("tok");
    expect(extractBearerToken(null)).toBeNull();
  });

  it("authenticates active token by hash", () => {
    const raw = "live-token";
    const agent = authenticateAgentToken(raw, [
      {
        agent_id: "agent-1",
        token_hash: hashAgentToken(raw),
        revoked_at: null,
      },
    ]);
    expect(agent?.agentId).toBe("agent-1");
  });
});

describe("agent authorization rules", () => {
  it("rejects cross-agent patch", () => {
    const result = planAgentPatch(
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      sampleItem(),
      { title: "hijack" },
    );
    expect(result.ok).toBe(false);
  });

  it("open approval may only be withdrawn, not done", () => {
    expect(
      assertAgentMaySetStatus("done", "approval", "open").ok,
    ).toBe(false);
    expect(
      assertAgentMaySetStatus("withdrawn", "approval", "open").ok,
    ).toBe(true);
    expect(assertAgentMaySetStatus("done", "todo", "open").ok).toBe(true);

    const result = planAgentPatch(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      sampleItem({ kind: "approval", status: "open" }),
      { status: "done" },
    );
    expect(result.ok).toBe(false);
  });

  it("reopens without writing stale status when content changes", () => {
    const item = sampleItem({ status: "approved" });
    const result = planAgentPatch(item.agent_id, item, {
      title: "new title",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.contentReopened).toBe(true);
      expect(result.plan.setStatus).toBe(true);
      expect(result.plan.newStatus).toBe("open");
      expect(result.plan.expectedStatus).toBe("approved");
    }
  });

  it("does not set status when only non-content fields change", () => {
    const item = sampleItem({ status: "open" });
    const result = planAgentPatch(item.agent_id, item, {
      project: "other",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.setStatus).toBe(false);
      expect(result.plan.newStatus).toBeNull();
    }
  });

  it("forbids kind change after user decision", () => {
    const result = planAgentPatch(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      sampleItem({ status: "approved" }),
      { kind: "todo" },
    );
    expect(result.ok).toBe(false);
  });

  it("assertAgentOwnsItem distinguishes owners", () => {
    expect(assertAgentOwnsItem("a", "a").ok).toBe(true);
    expect(assertAgentOwnsItem("a", "b").ok).toBe(false);
  });
});
