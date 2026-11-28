import type {
  DashboardBlockRow,
  DashboardSectionRow,
} from "@/lib/dashboard/types";

export type PlanResult<T> =
  | { ok: true; plan: T }
  | { ok: false; status: number; error: string };

function ownsRow(
  agentId: string,
  rowAgentId: string | null,
): boolean {
  return rowAgentId !== null && rowAgentId === agentId;
}

/**
 * Row-level ownership helper (audit / legacy). Write authorization for
 * dashboard categories is `assertAgentIsCategoryWriter`, not this check.
 */
export function assertSectionOwnedByAgent(
  agentId: string,
  section: Pick<DashboardSectionRow, "agent_id">,
): PlanResult<true> {
  if (!ownsRow(agentId, section.agent_id)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, plan: true };
}

/** Sisters may only mutate blocks whose agent_id is themselves (legacy helper). */
export function assertBlockOwnedByAgent(
  agentId: string,
  block: Pick<DashboardBlockRow, "agent_id">,
): PlanResult<true> {
  if (!ownsRow(agentId, block.agent_id)) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  return { ok: true, plan: true };
}

export type CreateSectionPlan = {
  category: string;
  sort_order: number;
  agent_id: string;
};

export function planCreateSection(
  agentId: string,
  input: { category: string; sort_order?: number },
): PlanResult<CreateSectionPlan> {
  return {
    ok: true,
    plan: {
      category: input.category,
      sort_order: input.sort_order ?? 0,
      agent_id: agentId,
    },
  };
}

export type PatchSectionPlan = {
  category?: string;
  sort_order?: number;
};

/**
 * Category-writer gate is enforced at the route. Planning only validates body.
 */
export function planPatchSection(
  _agentId: string,
  _section: DashboardSectionRow,
  input: { category?: string; sort_order?: number },
): PlanResult<PatchSectionPlan> {
  if (input.category === undefined && input.sort_order === undefined) {
    return { ok: false, status: 400, error: "invalid body" };
  }
  return {
    ok: true,
    plan: {
      category: input.category,
      sort_order: input.sort_order,
    },
  };
}

export type CreateBlockPlan = {
  section_id: string;
  block_type: DashboardBlockRow["block_type"];
  sort_order: number;
  agent_id: string;
  payload: Record<string, unknown>;
};

/**
 * Category-writer gate is enforced at the route / RPC. Planning checks section id.
 */
export function planCreateBlock(
  agentId: string,
  section: DashboardSectionRow,
  input: {
    section_id: string;
    block_type: DashboardBlockRow["block_type"];
    sort_order?: number;
    payload: Record<string, unknown>;
  },
): PlanResult<CreateBlockPlan> {
  if (section.id !== input.section_id) {
    return { ok: false, status: 400, error: "invalid body" };
  }
  return {
    ok: true,
    plan: {
      section_id: input.section_id,
      block_type: input.block_type,
      sort_order: input.sort_order ?? 0,
      agent_id: agentId,
      payload: input.payload,
    },
  };
}

export type PatchBlockPlan = {
  block_type?: DashboardBlockRow["block_type"];
  sort_order?: number;
  payload?: Record<string, unknown>;
};

export function planPatchBlock(
  _agentId: string,
  block: DashboardBlockRow,
  input: {
    block_type?: DashboardBlockRow["block_type"];
    sort_order?: number;
    payload?: Record<string, unknown>;
  },
): PlanResult<PatchBlockPlan> {
  if (
    input.block_type === undefined &&
    input.sort_order === undefined &&
    input.payload === undefined
  ) {
    return { ok: false, status: 400, error: "invalid body" };
  }
  if (
    input.block_type !== undefined &&
    input.block_type !== block.block_type &&
    input.payload === undefined
  ) {
    return { ok: false, status: 400, error: "invalid body" };
  }
  return {
    ok: true,
    plan: {
      block_type: input.block_type,
      sort_order: input.sort_order,
      payload: input.payload,
    },
  };
}

/** Extract headline sentence from decrypted blocks; empty if none. */
export function extractHeadline(
  blocks: Array<{
    block_type: string;
    payload: Record<string, unknown>;
    decrypt_failed?: boolean;
    sort_order: number;
  }>,
): string {
  const headlines = blocks
    .filter(
      (b) =>
        b.block_type === "headline" &&
        !b.decrypt_failed &&
        typeof b.payload.text === "string",
    )
    .sort((a, b) => a.sort_order - b.sort_order);
  const text = headlines[0]?.payload.text;
  return typeof text === "string" ? text : "";
}
