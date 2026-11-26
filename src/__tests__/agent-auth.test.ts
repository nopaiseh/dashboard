import { describe, expect, it } from "vitest";
import {
  assertAgentMaySetStatus,
  assertAgentOwnsItem,
  authenticateAgentToken,
  extractBearerToken,
} from "@/lib/agent-auth";
import { hashAgentToken } from "@/lib/crypto";
import { applyAgentPatch } from "@/lib/items-logic";
import type { ItemRow } from "@/lib/types";

function sampleItem(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    kind: "approval",
    agent_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    project: "p",
    title: "title",
    body: "body",
    options: [{ key: "a", label: "A" }],
    due_at: null,
    source_url: null,
    status: "open",
    content_hash: "hash",
    created_at: "2025-01-01T00:00:00.000Z",
    updated_at: "2025-01-01T00:00:00.000Z",
    last_activity_at: "2025-01-01T00:00:00.000Z",
    ...overrides,
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

  it("rejects agent writing approved/rejected", () => {
    expect(assertAgentMaySetStatus("approved").ok).toBe(false);
    expect(assertAgentMaySetStatus("rejected").ok).toBe(false);
    expect(assertAgentMaySetStatus("done").ok).toBe(true);

    const result = applyAgentPatch(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      sampleItem(),
      { status: "approved" },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/approved or rejected/i);
    }
  });

  it("allows owner agent to update and recomputes content_hash", () => {
    const item = sampleItem();
    const result = applyAgentPatch(item.agent_id, item, {
      title: "new title",
      body: "new body",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.title).toBe("new title");
      expect(result.next.content_hash).not.toBe(item.content_hash);
      expect(result.next.content_hash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("assertAgentOwnsItem distinguishes owners", () => {
    expect(assertAgentOwnsItem("a", "a").ok).toBe(true);
    expect(assertAgentOwnsItem("a", "b").ok).toBe(false);
  });
});
