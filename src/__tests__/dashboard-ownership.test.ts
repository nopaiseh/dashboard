import { describe, expect, it } from "vitest";
import {
  assertBlockOwnedByAgent,
  assertSectionOwnedByAgent,
  planCreateBlock,
  planPatchBlock,
  planPatchSection,
} from "@/lib/dashboard/logic";
import type {
  DashboardBlockRow,
  DashboardSectionRow,
} from "@/lib/dashboard/types";

const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "22222222-2222-4222-8222-222222222222";

function section(
  overrides: Partial<DashboardSectionRow> = {},
): DashboardSectionRow {
  return {
    id: SECTION_ID,
    category: "cpf",
    sort_order: 0,
    agent_id: AGENT_A,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function block(overrides: Partial<DashboardBlockRow> = {}): DashboardBlockRow {
  return {
    id: BLOCK_ID,
    section_id: SECTION_ID,
    block_type: "progress",
    sort_order: 0,
    agent_id: AGENT_A,
    payload: "v1:aa:bb:cc",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("dashboard sister ownership helpers", () => {
  it("rejects sister claiming another sister's block", () => {
    const owned = assertBlockOwnedByAgent(AGENT_B, block({ agent_id: AGENT_A }));
    expect(owned.ok).toBe(false);
    if (!owned.ok) {
      expect(owned.status).toBe(403);
      expect(owned.error).toBe("forbidden");
    }
  });

  it("rejects sister claiming another sister's section", () => {
    const owned = assertSectionOwnedByAgent(
      AGENT_B,
      section({ agent_id: AGENT_A }),
    );
    expect(owned.ok).toBe(false);
    if (!owned.ok) {
      expect(owned.status).toBe(403);
    }
  });

  it("treats null agent_id as not owned", () => {
    expect(assertBlockOwnedByAgent(AGENT_A, block({ agent_id: null })).ok).toBe(
      false,
    );
  });

  it("planCreateBlock no longer gates on section.agent_id (writer check is separate)", () => {
    const planned = planCreateBlock(AGENT_B, section({ agent_id: AGENT_A }), {
      section_id: SECTION_ID,
      block_type: "headline",
      payload: { text: "hi" },
    });
    expect(planned.ok).toBe(true);
  });

  it("planPatchBlock / planPatchSection plan without row ownership", () => {
    expect(
      planPatchBlock(AGENT_B, block({ agent_id: AGENT_A }), { sort_order: 2 })
        .ok,
    ).toBe(true);
    expect(
      planPatchSection(AGENT_B, section({ agent_id: AGENT_A }), {
        sort_order: 3,
      }).ok,
    ).toBe(true);
  });

  it("allows planning patch of own block", () => {
    const planned = planPatchBlock(AGENT_A, block({ agent_id: AGENT_A }), {
      payload: { title: "x", progress: 1 },
    });
    expect(planned.ok).toBe(true);
  });
});
