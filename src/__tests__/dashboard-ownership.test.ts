import { describe, expect, it } from "vitest";
import {
  assertBlockOwnedByAgent,
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

describe("dashboard sister ownership", () => {
  it("rejects sister writing another sister's block", () => {
    const owned = assertBlockOwnedByAgent(AGENT_B, block({ agent_id: AGENT_A }));
    expect(owned.ok).toBe(false);
    if (!owned.ok) {
      expect(owned.status).toBe(403);
      expect(owned.error).toBe("forbidden");
    }
  });

  it("rejects patch of another sister's block", () => {
    const planned = planPatchBlock(AGENT_B, block({ agent_id: AGENT_A }), {
      sort_order: 2,
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.status).toBe(403);
    }
  });

  it("rejects create into another sister's section", () => {
    const planned = planCreateBlock(AGENT_B, section({ agent_id: AGENT_A }), {
      section_id: SECTION_ID,
      block_type: "headline",
      payload: { text: "hi" },
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.status).toBe(403);
    }
  });

  it("rejects patch of another sister's section", () => {
    const planned = planPatchSection(AGENT_B, section({ agent_id: AGENT_A }), {
      sort_order: 3,
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.status).toBe(403);
    }
  });

  it("allows owner sister to patch own block", () => {
    const planned = planPatchBlock(AGENT_A, block({ agent_id: AGENT_A }), {
      payload: { title: "x", progress: 1 },
    });
    expect(planned.ok).toBe(true);
  });

  it("treats null agent_id blocks as not owned by any sister", () => {
    const planned = planPatchBlock(AGENT_A, block({ agent_id: null }), {
      sort_order: 1,
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) {
      expect(planned.status).toBe(403);
    }
  });
});
