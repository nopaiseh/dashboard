/**
 * 仅夹具 / 测试：用 PR #24 validation 允许的字段编成 blocks。
 * 生产代码不得引用本文件。
 */
import type { DashboardBlockPublic } from "@/lib/dashboard/types";
import {
  C2_ASSUMPTIONS,
  C2_BAL,
  C2_CHG_M,
  C2_CHG_Y,
  C2_CONCLUSION,
  C2_CONTRIB,
  C2_EMPLOYER_CHANGES,
  C2_EXCEED_FRS,
  C2_HIT,
  C2_INT_JAN,
  C2_INT_TOTAL,
  C2_LEDGER,
  C2_MONTHS,
  C2_OA_SA,
  C2_PROJ,
  C2_TARGETS,
  C2_TODOS,
  C2_TOTAL,
  C2_TRANSFERS,
  C2_YEAR_END,
} from "./c2SampleData";

const NOW = "2026-11-28T00:00:00.000Z";
const AGENT = "00000000-0000-4000-8000-000000000001";
const SEC = "sec-cpf";

function blk(
  id: string,
  block_type: DashboardBlockPublic["block_type"],
  sort_order: number,
  payload: Record<string, unknown>,
): DashboardBlockPublic {
  return {
    id,
    section_id: SEC,
    block_type,
    sort_order,
    payload,
    agent_id: AGENT,
    created_at: NOW,
    updated_at: NOW,
  };
}

function seriesFor(
  key: "OA" | "SA" | "MA",
  includeProjected: boolean,
): Array<{
  t: string;
  v: number;
  phase: "actual" | "projected";
  grain: "month" | "year";
}> {
  const years = Object.entries(C2_YEAR_END).map(([y, bal]) => ({
    t: y,
    v: bal[key],
    phase: "actual" as const,
    grain: "year" as const,
  }));
  const months = C2_MONTHS.filter((m) => m.t.startsWith("2026")).map((m) => ({
    t: m.t,
    v: m.balances[key],
    phase: "actual" as const,
    grain: "month" as const,
  }));
  // 近 12 个月里的 2025-11/12
  const m2025 = C2_MONTHS.filter((m) => m.t.startsWith("2025")).map((m) => ({
    t: m.t,
    v: m.balances[key],
    phase: "actual" as const,
    grain: "month" as const,
  }));
  const projected = includeProjected
    ? C2_PROJ.map((m) => ({
        t: m.t,
        v: m.balances[key],
        phase: "projected" as const,
        grain: "month" as const,
      }))
    : [];
  return [...years, ...m2025, ...months, ...projected];
}

/** C2 示例分区 blocks（字段均在 #24 schema 内）。 */
export function buildSampleCpfBlocks(): DashboardBlockPublic[] {
  const events = [
    ...C2_EMPLOYER_CHANGES.map((e) => ({
      t: e.t.slice(0, 7),
      kind: "employer_change" as const,
      label: e.label,
    })),
    ...C2_TRANSFERS.map((t) => ({
      t: String(t.year),
      kind: "lump_sum" as const,
      label: t.short,
    })),
  ];

  return [
    blk("blk-cpf-conclusion", "text", 0, {
      title: C2_CONCLUSION.title,
      text: C2_CONCLUSION.body,
    }),
    blk("blk-metric-oa", "metric", 1, {
      title: "普通户口 OA",
      value: C2_BAL.OA,
      unit: "S$",
      delta_mom: C2_CHG_M.OA,
      ytd: C2_CHG_Y.OA,
      label: "截至结算单 2026-10-31",
    }),
    blk("blk-metric-sa", "metric", 2, {
      title: "特别户口 SA",
      value: C2_BAL.SA,
      unit: "S$",
      delta_mom: C2_CHG_M.SA,
      ytd: C2_CHG_Y.SA,
      label: "截至结算单 2026-10-31",
    }),
    blk("blk-metric-ma", "metric", 3, {
      title: "保健储蓄 MA",
      value: C2_BAL.MA,
      unit: "S$",
      delta_mom: C2_CHG_M.MA,
      ytd: C2_CHG_Y.MA,
      label: "截至结算单 2026-10-31",
    }),
    blk("blk-metric-total", "metric", 4, {
      title: "合计 OA+SA+MA",
      value: C2_TOTAL,
      unit: "S$",
      delta_mom: C2_CONTRIB.total,
      ytd: C2_CHG_Y.OA + C2_CHG_Y.SA + C2_CHG_Y.MA,
      label: "截至结算单 2026-10-31",
    }),
    blk("blk-progress-ma", "progress", 5, {
      title: "MA 对 BHS",
      progress: Math.min(100, (C2_BAL.MA / C2_TARGETS.BHS) * 100),
      value: C2_BAL.MA,
      unit: "S$",
      tiers: [{ key: "BHS", label: "BHS", amount: C2_TARGETS.BHS }],
      next_tier: "BHS",
      next_tier_year: 2027,
      status: "2027-01",
    }),
    blk("blk-progress-oasa", "progress", 6, {
      title: "SA+OA 对 BRS / FRS / ERS",
      progress: Math.min(100, (C2_OA_SA / C2_TARGETS.ERS) * 100),
      value: C2_OA_SA,
      unit: "S$",
      tiers: [
        { key: "BRS", label: "BRS", amount: C2_TARGETS.BRS },
        { key: "FRS", label: "FRS", amount: C2_TARGETS.FRS },
        { key: "ERS", label: "ERS", amount: C2_TARGETS.ERS },
      ],
      reached_tier: "FRS",
      next_tier: "ERS",
      next_tier_year: 2030,
      overshoot: C2_EXCEED_FRS,
      status: "2030-07",
    }),
    blk("blk-chart-oa", "chart_series", 7, {
      title: "OA",
      series: seriesFor("OA", true),
      events,
      range_default: "12m",
      all_from_year: 2016,
    }),
    blk("blk-chart-sa", "chart_series", 8, {
      title: "SA",
      series: seriesFor("SA", true),
      range_default: "12m",
      all_from_year: 2016,
    }),
    blk("blk-chart-ma", "chart_series", 9, {
      title: "MA",
      series: seriesFor("MA", true),
      range_default: "12m",
      all_from_year: 2016,
    }),
    blk("blk-contrib", "list", 10, {
      title: "本月缴存",
      items: [
        JSON.stringify({
          OA: C2_CONTRIB.OA,
          SA: C2_CONTRIB.SA,
          MA: C2_CONTRIB.MA,
          employer: C2_CONTRIB.employer,
          self: C2_CONTRIB.self,
          total: C2_CONTRIB.total,
          annual_limit: C2_CONTRIB.annualLimit,
          paid_ytd: C2_CONTRIB.paidYtd,
          limit_left: C2_CONTRIB.limitLeft,
          as_of_month: C2_CONTRIB.asOfMonth,
          note: C2_CONTRIB.note,
        }),
      ],
    }),
    blk("blk-int-oa", "metric", 11, {
      title: "利息 OA",
      value: C2_INT_JAN.OA,
      unit: "S$",
    }),
    blk("blk-int-sa", "metric", 12, {
      title: "利息 SA",
      value: C2_INT_JAN.SA,
      unit: "S$",
    }),
    blk("blk-int-ma", "metric", 13, {
      title: "利息 MA",
      value: C2_INT_JAN.MA,
      unit: "S$",
    }),
    blk("blk-int-total", "metric", 14, {
      title: "利息合计",
      value: C2_INT_TOTAL,
      unit: "S$",
    }),
    blk("blk-rstu", "text", 15, {
      title: "RSTU 自愿填补",
      text: "今年还没有自愿填补。上限 S$ 8,000，税务减免尚未使用。\n12-31 截止。应急金和信用卡还清优先。",
      empty_text: "本年未填补",
    }),
    blk("blk-todos", "list", 16, {
      title: "相关待办",
      items: C2_TODOS.map((t) => JSON.stringify(t)),
    }),
    blk("blk-ledger", "list", 17, {
      title: "缴存和提取流水",
      empty_text:
        "近 6 个月没有买房、医疗就诊等提取。MA 支出仅为 MediShield Life 与 CareShield Life 保费。",
      items: C2_LEDGER.map((r) =>
        JSON.stringify({
          date: r.date,
          kind: r.kind,
          type_label: r.typeLabel,
          note: r.note,
          OA: r.OA,
          SA: r.SA,
          MA: r.MA,
          total: r.total,
        }),
      ),
    }),
    blk("blk-assumptions", "text", 18, {
      title: "估算说明",
      text: [
        C2_ASSUMPTIONS.contribLine,
        C2_ASSUMPTIONS.rateLine,
        ...C2_ASSUMPTIONS.bullets,
      ].join("\n"),
    }),
  ];
}

export { C2_CONCLUSION, C2_BAL, C2_TOTAL, C2_EXCEED_FRS, C2_HIT };
