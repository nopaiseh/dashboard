/**
 * 仅夹具 / 测试：把 c2SampleData 编成可被 parseCpfModel 解析的 blocks。
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
  C2_RATES,
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

function points12() {
  const actual = C2_MONTHS.map((m) => ({
    t: m.t,
    balances: m.balances,
    phase: "actual" as const,
    grain: "month" as const,
  }));
  const projected = C2_PROJ.filter((m) => m.t <= "2027-04").map((m) => ({
    t: m.t,
    balances: m.balances,
    phase: "projected" as const,
    grain: "month" as const,
  }));
  return [...actual, ...projected];
}

function pointsAll() {
  const years = Object.entries(C2_YEAR_END).map(([y, balances]) => ({
    t: y,
    balances,
    phase: "actual" as const,
    grain: "year" as const,
  }));
  const months2026 = C2_MONTHS.filter((m) => m.t.startsWith("2026")).map(
    (m) => ({
      t: m.t,
      balances: m.balances,
      phase: "actual" as const,
      grain: "month" as const,
    }),
  );
  const projected = C2_PROJ.map((m) => ({
    t: m.t,
    balances: m.balances,
    phase: "projected" as const,
    grain: "month" as const,
  }));
  return [...years, ...months2026, ...projected];
}

/** C2 示例分区的全部 blocks（含 c2_layout 标记）。 */
export function buildSampleCpfBlocks(): DashboardBlockPublic[] {
  return [
    blk("blk-c2-layout", "text", 0, {
      role: "c2_layout",
      title: C2_CONCLUSION.title,
      text: C2_CONCLUSION.body,
      reached_frs: C2_CONCLUSION.reachedFrs,
    }),
    blk("blk-cpf-accounts", "metric", 1, {
      role: "cpf_accounts",
      balances: C2_BAL,
      chg_m: C2_CHG_M,
      chg_y: C2_CHG_Y,
      as_of: "截至结算单 2026-10-31",
      month_contrib_total: C2_CONTRIB.total,
      month_interest: 0,
    }),
    blk("blk-cpf-progress", "progress", 2, {
      role: "cpf_progress",
      title: "目标进度",
      progress: C2_OA_SA / C2_TARGETS.ERS,
      ma: C2_BAL.MA,
      bhs: C2_TARGETS.BHS,
      oa_sa: C2_OA_SA,
      brs: C2_TARGETS.BRS,
      frs: C2_TARGETS.FRS,
      ers: C2_TARGETS.ERS,
      exceed_frs: C2_EXCEED_FRS,
      hit_bhs: C2_HIT.BHS,
      hit_brs: C2_HIT.BRS,
      hit_frs: C2_HIT.FRS,
      hit_ers: C2_HIT.ERS,
      footnote: `目标值为示例：BHS S$ ${C2_TARGETS.BHS.toLocaleString("en-SG")}、BRS S$ ${C2_TARGETS.BRS.toLocaleString("en-SG")}、FRS S$ ${C2_TARGETS.FRS.toLocaleString("en-SG")}、ERS S$ ${C2_TARGETS.ERS.toLocaleString("en-SG")}。越过的档位按实际比例显示（不卡在 100%），超出部分用斜纹标出，并指向下一档。达标年月为估算，目标按当前值计，不含每年上调。`,
    }),
    blk("blk-cpf-trend", "chart_series", 3, {
      role: "cpf_trend",
      points_12m: points12(),
      points_all: pointsAll(),
      events: [
        ...C2_EMPLOYER_CHANGES.map((e) => ({
          t: e.t,
          kind: "employer_change",
          label: e.label,
        })),
        ...C2_TRANSFERS.map((t) => ({
          t: String(t.year),
          kind: "lump_sum",
          label: t.label,
          short: t.short,
        })),
      ],
      guides: [
        {
          key: "FRS",
          amount: C2_TARGETS.FRS,
          label: `FRS 已达 · ${C2_HIT.FRS}`,
        },
        {
          key: "BRS",
          amount: C2_TARGETS.BRS,
          label: `BRS 已达 · ${C2_HIT.BRS}`,
        },
      ],
      jan_interest_at: "2026-01",
      jan_interest_total: C2_INT_TOTAL,
      range_default: "12m",
      subtitle_12m: "2025 年 11 月 – 2026 年 10 月，均为月底数",
      subtitle_all: "2016–2025 年底数 · 2026 起月底数 · 虚线为推算",
    }),
    blk("blk-cpf-contrib", "metric", 4, {
      role: "cpf_contrib",
      ...C2_CONTRIB,
      as_of_month: C2_CONTRIB.asOfMonth,
      annual_limit: C2_CONTRIB.annualLimit,
      paid_ytd: C2_CONTRIB.paidYtd,
      limit_left: C2_CONTRIB.limitLeft,
    }),
    blk("blk-cpf-annual", "text", 5, {
      role: "cpf_annual",
      year_label: "2026 年 1 月入账的利息 （2025 年度）",
      rates: {
        OA: `${(C2_RATES.OA * 100).toFixed(1)}%`,
        SA: "4.0% + 额外 1%",
        MA: "4.0%",
      },
      interest: C2_INT_JAN,
      interest_total: C2_INT_TOTAL,
      note: "每年 1 月入账一次，下次 2027 年 1 月。头 S$ 60,000 的额外 1% 计入 SA。利息栏通常只显示合计；示例里 2020 年在「全部」走势图的悬停提示中拆成基本利息 + 额外利息。",
      rstu_empty: true,
      rstu_title: "本年未填补",
      rstu_body: "今年还没有自愿填补。上限 S$ 8,000，税务减免尚未使用。",
      rstu_extra: "12-31 截止。应急金和信用卡还清优先。",
      rstu_due_chip: "12-31 截止",
    }),
    blk("blk-cpf-todos", "list", 6, {
      role: "cpf_todos",
      items: C2_TODOS,
    }),
    blk("blk-cpf-ledger", "list", 7, {
      role: "cpf_ledger",
      rows: C2_LEDGER.map((r) => ({
        date: r.date,
        kind: r.kind,
        type_label: r.typeLabel,
        note: r.note,
        OA: r.OA,
        SA: r.SA,
        MA: r.MA,
        total: r.total,
      })),
      summary: "缴存 +17,760 · 保险扣款 −500 · 提取 0",
      empty_withdrawals:
        "近 6 个月没有买房、医疗就诊等提取。MA 支出仅为 MediShield Life 与 CareShield Life 保费。",
    }),
    blk("blk-cpf-assumptions", "text", 8, {
      role: "cpf_assumptions",
      contrib_line: C2_ASSUMPTIONS.contribLine,
      contrib_detail: C2_ASSUMPTIONS.contribDetail,
      rate_line: C2_ASSUMPTIONS.rateLine,
      rate_extra: C2_ASSUMPTIONS.rateExtra,
      bullets: [...C2_ASSUMPTIONS.bullets],
      byline: C2_ASSUMPTIONS.byline,
    }),
  ];
}

export { C2_CONCLUSION, C2_BAL, C2_TOTAL, C2_EXCEED_FRS, C2_HIT };
