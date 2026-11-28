import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/components/qingjian/DashboardView";
import { CpfProgress } from "@/components/qingjian/dashboard/CpfProgress";
import { CpfSection } from "@/components/qingjian/dashboard/CpfSection";
import { StackedTrendChart } from "@/components/qingjian/dashboard/StackedTrendChart";
import {
  parseCpfModel,
  reachedFrsFromTier,
} from "@/components/qingjian/dashboard/parseCpfModel";
import {
  C2_BAL,
  C2_EXCEED_FRS,
  C2_TOTAL,
} from "@/components/qingjian/dashboard/fixtures/c2SampleData";
import {
  C2_MARKER_ONLY_DASHBOARD,
  EMPTY_DASHBOARD,
  SAMPLE_DASHBOARD,
} from "@/components/qingjian/dashboard/fixtures";
import {
  isDashboardEmpty,
  sortSectionsForView,
} from "@/components/qingjian/dashboard/sortSections";
import { PROJECTION_NOTE } from "@/components/qingjian/dashboard/labels";
import { CPF_COLORS } from "@/components/qingjian/dashboard/cpfTheme";
import type { DashboardSectionPublic } from "@/lib/dashboard/types";

const SAMPLE_AMOUNTS = [
  C2_BAL.OA.toLocaleString("en-SG"),
  C2_BAL.SA.toLocaleString("en-SG"),
  C2_BAL.MA.toLocaleString("en-SG"),
  C2_TOTAL.toLocaleString("en-SG"),
  C2_EXCEED_FRS.toLocaleString("en-SG"),
  "205,181",
  "335,575",
  "42,962",
];

describe("dashboard section ordering", () => {
  it("pins cpf first even when sort_order is higher", () => {
    const ordered = sortSectionsForView(SAMPLE_DASHBOARD.sections);
    expect(ordered.map((s) => s.category)).toEqual(["cpf", "travel"]);
  });

  it("treats empty headline + no body blocks as page empty", () => {
    expect(isDashboardEmpty("", [])).toBe(true);
    expect(isDashboardEmpty("有头条", [])).toBe(false);
    expect(isDashboardEmpty("", SAMPLE_DASHBOARD.sections)).toBe(false);
  });
});

describe("reached_tier → 已达 FRS", () => {
  it("treats FRS and ERS as reached FRS; BRS and empty as not", () => {
    expect(reachedFrsFromTier("FRS")).toBe(true);
    expect(reachedFrsFromTier("ERS")).toBe(true);
    expect(reachedFrsFromTier("frs")).toBe(true);
    expect(reachedFrsFromTier("BRS")).toBe(false);
    expect(reachedFrsFromTier(undefined)).toBe(false);
    expect(reachedFrsFromTier("")).toBe(false);
  });

  it("parseCpfModel sets reachedFrs from progress.reached_tier only", () => {
    const base = {
      id: "sec",
      category: "cpf",
      sort_order: 0,
      agent_id: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const withFrs: DashboardSectionPublic = {
      ...base,
      blocks: [
        {
          id: "p1",
          section_id: "sec",
          block_type: "progress",
          sort_order: 0,
          agent_id: null,
          created_at: base.created_at,
          updated_at: base.updated_at,
          payload: {
            title: "SA+OA 对 BRS / FRS / ERS",
            progress: 60,
            value: 262_962,
            tiers: [
              { key: "BRS", label: "BRS", amount: 110_000 },
              { key: "FRS", label: "FRS", amount: 220_000 },
              { key: "ERS", label: "ERS", amount: 440_000 },
            ],
            reached_tier: "FRS",
            next_tier: "ERS",
            next_tier_year: 2030,
            overshoot: 42_962,
          },
        },
        {
          id: "p2",
          section_id: "sec",
          block_type: "progress",
          sort_order: 1,
          agent_id: null,
          created_at: base.created_at,
          updated_at: base.updated_at,
          payload: {
            title: "MA 对 BHS",
            progress: 97,
            value: 72_613,
            tiers: [{ key: "BHS", label: "BHS", amount: 75_000 }],
          },
        },
        {
          id: "t1",
          section_id: "sec",
          block_type: "text",
          sort_order: 2,
          agent_id: null,
          created_at: base.created_at,
          updated_at: base.updated_at,
          payload: { title: "结论", text: "说明" },
        },
      ],
    };
    const model = parseCpfModel(withFrs, "");
    expect(model.conclusion?.reachedFrs).toBe(true);

    const withBrsOnly = {
      ...withFrs,
      blocks: withFrs.blocks.map((b) =>
        b.id === "p1"
          ? {
              ...b,
              payload: { ...b.payload, reached_tier: "BRS", overshoot: 0 },
            }
          : b,
      ),
    };
    expect(parseCpfModel(withBrsOnly, "").conclusion?.reachedFrs).toBe(false);
  });
});

describe("C2 CPF section", () => {
  it("renders nine-part layout with Chinese account labels and c2 numbers in sampleMode", () => {
    const cpf = SAMPLE_DASHBOARD.sections.find((s) => s.category === "cpf")!;
    const model = parseCpfModel(cpf, SAMPLE_DASHBOARD.headline);
    const html = renderToStaticMarkup(
      createElement(CpfSection, { model, sampleMode: true }),
    );
    expect(html).toContain("普通户口 OA");
    expect(html).toContain("特别户口 SA");
    expect(html).toContain("保健储蓄 MA");
    expect(html).toContain("合计");
    expect(html).not.toContain("Ordinary Account");
    expect(html).toContain(C2_BAL.OA.toLocaleString("en-SG"));
    expect(html).toContain(C2_TOTAL.toLocaleString("en-SG"));
    expect(html).toContain("MA 对 BHS");
    expect(html).toContain("SA+OA 对 BRS / FRS / ERS");
    expect(html).toContain("本月缴存");
    expect(html).toContain("本年未填补");
    expect(html).toContain("相关待办");
    expect(html).toContain("不可逆");
    expect(html).toContain("无提取");
    expect(html).toContain("估算说明");
    expect(html).toContain(PROJECTION_NOTE.slice(0, 8));
    expect(html).toContain(String(C2_EXCEED_FRS.toLocaleString("en-SG")));
    expect(html).toContain("2030 年");
    expect(html).toContain("已达 FRS");
    expect(model.conclusion?.reachedFrs).toBe(true);
  });

  it("progress uses thin SVG bar with aligned tier labels and overshoot hatch", () => {
    const cpf = SAMPLE_DASHBOARD.sections.find((s) => s.category === "cpf")!;
    const model = parseCpfModel(cpf, SAMPLE_DASHBOARD.headline);
    const html = renderToStaticMarkup(
      createElement(CpfProgress, { data: model.progress }),
    );
    expect(html).toContain("k-progressSvg");
    expect(html).toContain("BRS");
    expect(html).toContain("FRS");
    expect(html).toContain("ERS");
    expect(html).toContain("现在 → 下一档");
    expect(html).toContain("c2-over-");
  });

  it("chart exposes keyboard-operable range tabs and stacked series", () => {
    const cpf = SAMPLE_DASHBOARD.sections.find((s) => s.category === "cpf")!;
    const model = parseCpfModel(cpf, SAMPLE_DASHBOARD.headline);
    const html = renderToStaticMarkup(
      createElement(StackedTrendChart, { data: model.trend }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain("近 12 个月");
    expect(html).toContain("全部（2016 年起）");
    expect(html).toContain("月底数");
    expect(html).toContain(CPF_COLORS.oa);
  });
});

describe("dashboard UI rendering", () => {
  it("sample dashboard shows C2 CPF then travel, with sample banner only in sampleMode", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: SAMPLE_DASHBOARD,
        sampleMode: true,
      }),
    );
    expect(html).toContain("示例数据");
    expect(html).toContain("普通户口 OA");
    expect(html).toContain("旅行");
    expect(html.indexOf("一句话结论")).toBeLessThan(html.indexOf("旅行"));
    expect(html).not.toContain("k-yearGap");
    expect(html).not.toContain("style=");
  });

  it("production mode with full sample fixture still parses blocks but has no sample banner", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: SAMPLE_DASHBOARD,
        sampleMode: false,
      }),
    );
    expect(html).not.toContain("此页所有数字、日期均为设计稿占位");
    expect(html).toContain("普通户口 OA");
    expect(html).not.toContain('class="banner"');
  });

  it("production cpf section with empty/missing fields shows empties and no sample amounts", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: C2_MARKER_ONLY_DASHBOARD,
        sampleMode: false,
      }),
    );
    expect(html).not.toContain("此页所有数字、日期均为设计稿占位");
    expect(html).not.toContain("已达 FRS");
    expect(html).toContain("暂无结论");
    expect(html).toContain("暂无户口余额");
    expect(html).toContain("暂无目标进度");
    expect(html).toContain("暂无走势数据");
    expect(html).toContain("暂无本月缴存");
    expect(html).toContain("暂无年度数据");
    expect(html).toContain("暂无待办");
    expect(html).toContain("暂无流水");
    for (const amount of SAMPLE_AMOUNTS) {
      expect(html).not.toContain(amount);
    }
  });

  it("renders calm page empty state without headline", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, { data: EMPTY_DASHBOARD }),
    );
    expect(html).toContain("暂无看板内容");
    expect(html).not.toContain("一句话结论");
  });

  it("overdue todo is marked and irreversible badge present from parsed model", () => {
    const cpf = SAMPLE_DASHBOARD.sections.find((s) => s.category === "cpf")!;
    const model = parseCpfModel(cpf, SAMPLE_DASHBOARD.headline);
    const html = renderToStaticMarkup(
      createElement(CpfSection, { model, sampleMode: true }),
    );
    expect(html).toContain("k-late");
    expect(html).toContain("k-badgeRed");
    expect(html).toContain("不可逆");
  });
});
