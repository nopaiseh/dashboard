/**
 * 示例数据夹具 — 仅供本地故事 / 截图 / 单测。
 * 公积金数字对齐 c2_model.py（C2 定稿），标明「示例数据」。
 * 生产 DashboardView 不得依赖本文件中的示例金额（仅可引用 EMPTY_DASHBOARD 类型用途时需小心；
 * sectionUsesC2Layout 已迁至 cpfLayout.ts）。
 */
import type {
  DashboardReadResult,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";
import { buildSampleCpfBlocks, C2_CONCLUSION } from "./fixtures/buildSampleCpfBlocks";

const NOW = "2026-11-28T00:00:00.000Z";
const AGENT = "00000000-0000-4000-8000-000000000001";

function section(
  partial: Omit<
    DashboardSectionPublic,
    "created_at" | "updated_at" | "agent_id"
  > & { agent_id?: string | null },
): DashboardSectionPublic {
  return {
    agent_id: partial.agent_id ?? AGENT,
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  };
}

/** C2 定稿示例看板（截图 / 单测）：完整 blocks，由 parseCpfModel 解析。 */
export const SAMPLE_DASHBOARD: DashboardReadResult = {
  headline: C2_CONCLUSION.title,
  sections: [
    section({
      id: "sec-travel",
      category: "travel",
      sort_order: 0,
      blocks: [
        {
          id: "blk-travel-list",
          section_id: "sec-travel",
          block_type: "list",
          sort_order: 0,
          payload: {
            title: "行程备忘（示例）",
            items: ["京都 4 晚", "大阪 2 晚", "预留一日机动"],
          },
          agent_id: AGENT,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    }),
    section({
      id: "sec-cpf",
      category: "cpf",
      sort_order: 10,
      blocks: buildSampleCpfBlocks(),
    }),
  ],
};

/** 仅有 c2 布局标记、无业务字段 — 用于正式路径空状态测试。 */
export const C2_MARKER_ONLY_DASHBOARD: DashboardReadResult = {
  headline: "",
  sections: [
    section({
      id: "sec-cpf-empty",
      category: "cpf",
      sort_order: 0,
      blocks: [
        {
          id: "blk-c2-only",
          section_id: "sec-cpf-empty",
          block_type: "text",
          sort_order: 0,
          payload: {
            role: "c2_layout",
            title: "",
            text: "",
          },
          agent_id: AGENT,
          created_at: NOW,
          updated_at: NOW,
        },
      ],
    }),
  ],
};

export const EMPTY_DASHBOARD: DashboardReadResult = {
  headline: "",
  sections: [],
};

/** @deprecated 使用 cpfLayout.sectionUsesC2Layout；保留再导出以免旧测试路径断裂。 */
export { sectionUsesC2Layout } from "./cpfLayout";
