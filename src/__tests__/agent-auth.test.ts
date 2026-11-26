import { describe, expect, it } from "vitest";
import {
  assertAgentMaySetStatus,
  assertAgentOwnsItem,
  authenticateAgentToken,
  extractBearerToken,
} from "@/lib/agent-auth";
import { computeContentHash } from "@/lib/content-hash";
import { hashAgentToken } from "@/lib/crypto";
import { applyAgentPatch } from "@/lib/items-logic";
import type { ItemRow } from "@/lib/types";

function sampleItem(overrides: Partial<ItemRow> = {}): ItemRow {
  const title = overrides.title ?? "title";
  const body = overrides.body ?? "body";
  const options = overrides.options ?? [{ key: "a", label: "A" }];
  const base: ItemRow = {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "approval",
    agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    project: "p",
    title,
    body,
    options,
    due_at: null,
    source_url: null,
    status: "open",
    content_hash: computeContentHash(title, body, options),
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    last_activity_at: "2025-01-01T00:00:00.000Z",
  };
  return {
    ...base,
    ...overrides,
    content_hash:
      overrides.content_hash ??
      computeContentHash(
        overrides.title ?? base.title,
        overrides.body ?? base.body,
        overrides.options ?? base.options,
      ),
  };
}

describe("agent auth", () => {
  it("extracts bearer token", () => {
    expect(extractBearerToken("Bearer tok")).toBe("tok");
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken("Basic x")).toBeNull();
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

  it("rejects revoked tokens", () => {
    const raw = "revoked-token";
    const agent = authenticateAgentToken(raw, [
      {
        agent_id: "agent-1",
        token_hash: hashAgentToken(raw),
        revoked_at: "2025-01-02T00:00:00.000Z",
      },
    ]);
    expect(agent).toBeNull();
  });
});

describe("agent authorization rules", () => {
  it("rejects cross-agent patch", () => {
    const result = applyAgentPatch(
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      sampleItem(),
      { title: "hijack" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });

  it("only allows done/withdrawn status; rejects approved/rejected/replied", () => {
    expect(assertAgentMaySetStatus("done").ok).toBe(true);
    expect(assertAgentMaySetStatus("withdrawn").ok).toBe(true);
    expect(assertAgentMaySetStatus("approved").ok).toBe(false);
    expect(assertAgentMaySetStatus("rejected").ok).toBe(false);
    expect(assertAgentMaySetStatus("replied").ok).toBe(false);
    expect(assertAgentMaySetStatus("open").ok).toBe(false);

    const result = applyAgentPatch(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      sampleItem(),
      { status: "approved" },
    );
    expect(result.ok).toBe(false);
  });

  it("reopens to open and recomputes hash when content changes", () => {
    const item = sampleItem({
      status: "approved",
      content_hash: "old",
    });
    const result = applyAgentPatch(item.agent_id, item, {
      title: "new title",
      body: "new body",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentReopened).toBe(true);
      expect(result.next.status).toBe("open");
      expect(result.next.content_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.next.content_hash).not.toBe("old");
    }
  });

  it("forbids kind change after user decision", () => {
    const result = applyAgentPatch(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      sampleItem({ status: "approved" }),
      { kind: "todo" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/kind/i);
    }
  });

  it("assertAgentOwnsItem distinguishes owners", () => {
    expect(assertAgentOwnsItem("a", "a").ok).toBe(true);
    expect(assertAgentOwnsItem("a", "b").ok).toBe(false);
  });
});
