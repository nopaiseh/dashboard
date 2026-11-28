/**
 * 示例数据夹具 — 仅供本地故事 / 截图 / 单测。
 * 数值与事件均为虚构，不得当作真实 CPF 数据。
 */
import type {
  DashboardBlockPublic,
  DashboardReadResult,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";

const NOW = "2026-11-28T00:00:00.000Z";

function block(
  partial: Omit<DashboardBlockPublic, "created_at" | "updated_at" | "agent_id"> & {
    agent_id?: string | null;
  },
): DashboardBlockPublic {
  return {
    agent_id: partial.agent_id ?? "00000000-0000-4000-8000-000000000001",
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  };
}

function section(
  partial: Omit<DashboardSectionPublic, "created_at" | "updated_at" | "agent_id"> & {
    agent_id?: string | null;
  },
): DashboardSectionPublic {
  return {
    agent_id: partial.agent_id ?? "00000000-0000-4000-8000-000000000001",
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  };
}

/** Full sample dashboard for stories / screenshots. Marked 示例数据 in UI. */
export const SAMPLE_DASHBOARD: DashboardReadResult = {
  headline: "示例数据：OA 已过 FRS，关注利息与下一档 ERS。",
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
          id: "blk-oa",
          section_id: "sec-cpf",
          block_type: "metric",
          sort_order: 0,
          payload: {
            title: "Ordinary Account",
            value: 128_400,
            unit: "S$",
            label: "余额",
            delta_mom: 820,
            ytd: 9_450,
            ytd_label: "年初至今",
          },
        }),
        block({
          id: "blk-progress",
          section_id: "sec-cpf",
          block_type: "progress",
          sort_order: 1,
          payload: {
            title: "退休总和对照",
            progress: 1.06,
            unit: "S$",
            value: 225_400,
            tiers: [
              { key: "BRS", label: "BRS", amount: 106_500 },
              { key: "FRS", label: "FRS", amount: 213_000 },
              { key: "ERS", label: "ERS", amount: 426_000 },
            ],
            reached_tier: "FRS",
            overshoot: 12_400,
            next_tier: "ERS",
            next_tier_year: 2038,
          },
        }),
        block({
          id: "blk-interest",
          section_id: "sec-cpf",
          block_type: "metric",
          sort_order: 2,
          payload: {
            title: "本年利息（合计）",
            value: 3_280,
            unit: "S$",
            label: "仅合计",
          },
        }),
        block({
          id: "blk-topup-empty",
          section_id: "sec-cpf",
          block_type: "list",
          sort_order: 3,
          payload: {
            title: "自愿填补",
            items: [],
            empty: "本年未填补",
          },
        }),
        block({
          id: "blk-withdraw-empty",
          section_id: "sec-cpf",
          block_type: "text",
          sort_order: 4,
          payload: {
            title: "提取记录",
            text: "",
            empty: "无提取",
            missing_years: ["2020"],
          },
        }),
        block({
          id: "blk-series",
          section_id: "sec-cpf",
          block_type: "chart_series",
          sort_order: 5,
          payload: {
            title: "余额走势（示例）",
            unit: "S$",
            series: [
              { t: "2016", v: 42_000, grain: "year" },
              { t: "2017", v: 48_500, grain: "year" },
              { t: "2018", v: 55_200, grain: "year" },
              { t: "2019", v: 63_000, grain: "year" },
              { t: "2020", v: 70_800, grain: "year" },
              { t: "2021", v: 79_400, grain: "year" },
              { t: "2022", v: 88_900, grain: "year" },
              { t: "2023", v: 99_200, grain: "year" },
              { t: "2024", v: 110_500, grain: "year" },
              { t: "2025-01", v: 111_200, grain: "month" },
              { t: "2025-02", v: 112_000, grain: "month" },
              { t: "2025-03", v: 113_100, grain: "month" },
              { t: "2025-04", v: 114_000, grain: "month" },
              { t: "2025-05", v: 115_200, grain: "month" },
              { t: "2025-06", v: 116_400, grain: "month" },
              { t: "2025-07", v: 117_500, grain: "month" },
              { t: "2025-08", v: 118_700, grain: "month" },
              { t: "2025-09", v: 119_900, grain: "month" },
              { t: "2025-10", v: 121_100, grain: "month" },
              { t: "2025-11", v: 122_400, grain: "month" },
              { t: "2025-12", v: 123_800, grain: "month", phase: "actual" },
              { t: "2026-01", v: 124_600, grain: "month" },
              { t: "2026-02", v: 125_500, grain: "month" },
              { t: "2026-03", v: 126_300, grain: "month" },
              { t: "2026-04", v: 127_100, grain: "month" },
              { t: "2026-05", v: 127_800, grain: "month" },
              { t: "2026-06", v: 128_400, grain: "month" },
              { t: "2026-07", v: 129_200, grain: "month", phase: "projected" },
              { t: "2026-08", v: 130_000, grain: "month", phase: "projected" },
              { t: "2026-09", v: 130_900, grain: "month", phase: "projected" },
              { t: "2026-10", v: 131_700, grain: "month", phase: "projected" },
              { t: "2026-11", v: 132_600, grain: "month", phase: "projected" },
              { t: "2026-12", v: 133_500, grain: "month", phase: "projected" },
            ],
            events: [
              {
                t: "2025-03",
                kind: "employer_change",
                label: "换雇主",
              },
              {
                t: "2024",
                kind: "lump_sum",
                label: "一次性转入",
              },
            ],
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
