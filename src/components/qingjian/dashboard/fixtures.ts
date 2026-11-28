/**
 * 示例数据夹具 — 仅供本地故事 / 截图 / 单测。
 * 公积金数字对齐 c2_model.py（C2 定稿），标明「示例数据」。
 */
import type {
  DashboardBlockPublic,
  DashboardReadResult,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";
import { C2_CONCLUSION } from "./c2Data";

const NOW = "2026-11-28T00:00:00.000Z";

function block(
  partial: Omit<
    DashboardBlockPublic,
    "created_at" | "updated_at" | "agent_id"
  > & { agent_id?: string | null },
): DashboardBlockPublic {
  return {
    agent_id: partial.agent_id ?? "00000000-0000-4000-8000-000000000001",
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  };
}

function section(
  partial: Omit<
    DashboardSectionPublic,
    "created_at" | "updated_at" | "agent_id"
  > & { agent_id?: string | null },
): DashboardSectionPublic {
  return {
    agent_id: partial.agent_id ?? "00000000-0000-4000-8000-000000000001",
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  };
}

/** C2 定稿示例看板（截图 / 单测）。 */
export const SAMPLE_DASHBOARD: DashboardReadResult = {
  headline: C2_CONCLUSION.title,
  sections: [
    section({
      id: "sec-travel",
      category: "travel",
      sort_order: 0,
      blocks: [
        block({
          id: "blk-travel-list",
          section_id: "sec-travel",
          block_type: "list",
          sort_order: 0,
          payload: {
            title: "行程备忘（示例）",
            items: ["京都 4 晚", "大阪 2 晚", "预留一日机动"],
          },
        }),
      ],
    }),
    section({
      id: "sec-cpf",
      category: "cpf",
      sort_order: 10,
      blocks: [
        block({
          id: "blk-c2-layout",
          section_id: "sec-cpf",
          block_type: "text",
          sort_order: 0,
          payload: {
            role: "c2_layout",
            text: C2_CONCLUSION.body,
            title: C2_CONCLUSION.title,
          },
        }),
      ],
    }),
  ],
};

export const EMPTY_DASHBOARD: DashboardReadResult = {
  headline: "",
  sections: [],
};

export function sectionUsesC2Layout(
  section: DashboardSectionPublic,
): boolean {
  return section.blocks.some(
    (b) =>
      b.payload.role === "c2_layout" || b.payload.layout === "c2",
  );
}
