import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/components/qingjian/DashboardView";
import {
  CpfProgress,
  ratioPct,
  resolveRetirementStatuses,
} from "@/components/qingjian/dashboard/CpfProgress";
import { CpfSection } from "@/components/qingjian/dashboard/CpfSection";
import { StackedTrendChart } from "@/components/qingjian/dashboard/StackedTrendChart";
import {
  parseCpfModel,
  reachedFrsFromTier,
} from "@/components/qingjian/dashboard/parseCpfModel";
import { parseMissingYears, parseTextPayload } from "@/components/qingjian/dashboard/parse";
import { MissingYearStripe } from "@/components/qingjian/dashboard/EmptyBlock";
import {
  formatWan,
  progressFill,
} from "@/components/qingjian/dashboard/format";
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
import type {
  DashboardBlockPublic,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";

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
  const retirementTiers = [
    { key: "BRS", amount: 110_000 },
    { key: "FRS", amount: 220_000 },
    { key: "ERS", amount: 440_000 },
  ];

  it("BRS→未达、FRS/frs→已达、ERS→已达、空/未知→未达（对照 tiers 顺序）", () => {
    expect(reachedFrsFromTier("BRS", retirementTiers)).toBe(false);
    expect(reachedFrsFromTier("FRS", retirementTiers)).toBe(true);
    expect(reachedFrsFromTier("frs", retirementTiers)).toBe(true);
    expect(reachedFrsFromTier("ERS", retirementTiers)).toBe(true);
    expect(reachedFrsFromTier(undefined, retirementTiers)).toBe(false);
    expect(reachedFrsFromTier("", retirementTiers)).toBe(false);
    expect(reachedFrsFromTier("UNKNOWN", retirementTiers)).toBe(false);
    expect(reachedFrsFromTier("BHS", retirementTiers)).toBe(false);
  });

  it("ranks by amount when tiers order differs from amount", () => {
    const reversed = [
      { key: "ERS", amount: 440_000 },
      { key: "FRS", amount: 220_000 },
      { key: "BRS", amount: 110_000 },
    ];
    expect(reachedFrsFromTier("BRS", reversed)).toBe(false);
    expect(reachedFrsFromTier("ERS", reversed)).toBe(true);
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

    const withErs = {
      ...withFrs,
      blocks: withFrs.blocks.map((b) =>
        b.id === "p1"
          ? {
              ...b,
              payload: { ...b.payload, reached_tier: "ERS", overshoot: 0 },
            }
          : b,
      ),
    };
    expect(parseCpfModel(withErs, "").conclusion?.reachedFrs).toBe(true);

    const withUnknown = {
      ...withFrs,
      blocks: withFrs.blocks.map((b) =>
        b.id === "p1"
          ? {
              ...b,
              payload: { ...b.payload, reached_tier: "XYZ" },
            }
          : b,
      ),
    };
    expect(parseCpfModel(withUnknown, "").conclusion?.reachedFrs).toBe(false);
  });
});

describe("missing_years (#24 number[])", () => {
  it("accepts number years and string years; ignores junk", () => {
    expect(parseMissingYears([2022, 2023])).toEqual(["2022", "2023"]);
    expect(parseMissingYears(["2021", "2024"])).toEqual(["2021", "2024"]);
    expect(parseMissingYears([2020, "2019", "nope", 1.5, null])).toEqual([
      "2020",
      "2019",
    ]);
    expect(parseMissingYears(undefined)).toEqual([]);
  });

  it("parseTextPayload keeps numeric missing_years for MissingYearStripe", () => {
    const view = parseTextPayload({
      title: "估算说明",
      text: "正文",
      missing_years: [2021, 2023],
    });
    expect(view).not.toBeNull();
    expect(view!.missingYears).toEqual(["2021", "2023"]);
    const html = renderToStaticMarkup(
      createElement(MissingYearStripe, { years: view!.missingYears }),
    );
    expect(html).toContain("2021");
    expect(html).toContain("2023");
    expect(html).toContain("该年暂无结算单");
  });
});

describe("progressFill percent (always 0–100 scale)", () => {
  it("treats 0.55 as 0.55% not a ratio, and 55 as 55%", () => {
    expect(progressFill(0.55).withinPct).toBe(0.6); // rounded 0.55%
    expect(progressFill(0.55).ratio).toBeCloseTo(0.0055);
    expect(progressFill(55).withinPct).toBe(55);
    expect(progressFill(55).ratio).toBe(0.55);
    expect(progressFill(112).withinPct).toBe(100);
    expect(progressFill(112).overshootPct).toBe(12);
  });

  it("formatWan derives tick labels from targets", () => {
    expect(formatWan(75_000)).toBe("7.5万");
    expect(formatWan(110_000)).toBe("11万");
    expect(formatWan(220_000)).toBe("22万");
    expect(formatWan(440_000)).toBe("44万");
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
    expect(html).toContain("OA 转 SA（不可逆，需本人决定）");
    expect(html).toContain("无提取");
    expect(html).toContain("估算说明");
    expect(html).toContain(PROJECTION_NOTE.slice(0, 8));
    expect(html).toContain(String(C2_EXCEED_FRS.toLocaleString("en-SG")));
    expect(html).toContain("2030 年");
    expect(html).toContain("下一档，约");
    expect(html).toContain("已达 FRS");
    expect(html).toContain("k-tblScroll");
    expect(html).toContain('aria-label="本月缴存表格"');
    expect(html).toContain('aria-label="流水表格"');
    expect(html).toContain('aria-label="年度利息表格"');
    expect(html).not.toContain(" · 利息 ");
    expect(model.conclusion?.reachedFrs).toBe(true);
    expect(model.accounts?.monthContribTotal).toBe(2960);
    expect(model.accounts).not.toBeNull();
    const bal = model.accounts!.balances;
    expect(bal.OA + bal.SA + bal.MA).toBe(C2_TOTAL);
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
    expect(html).toContain("7.5万");
    expect(html).toContain("11万");
    expect(html).toContain("22万");
    expect(html).toContain("44万");
    expect(html).toContain("现在 → 下一档");
    expect(html).toContain("c2-over-");
    expect(html).toContain("已达，超出");
    expect(html).toContain("下一档，约");
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

describe("parseCpfModel block_key + title fallback", () => {
  const baseMeta = {
    section_id: "sec",
    agent_id: null as string | null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  function section(blocks: DashboardBlockPublic[]): DashboardSectionPublic {
    return {
      id: "sec",
      category: "cpf",
      sort_order: 0,
      agent_id: null,
      created_at: baseMeta.created_at,
      updated_at: baseMeta.updated_at,
      blocks,
    };
  }

  function metric(
    id: string,
    payload: Record<string, unknown>,
    sort = 0,
  ): DashboardBlockPublic {
    return {
      id,
      block_type: "metric",
      sort_order: sort,
      payload,
      ...baseMeta,
    };
  }

  it("prefers block_key over title when both present", () => {
    const model = parseCpfModel(
      section([
        metric("oa", {
          block_key: "cpf_acc_oa",
          title: "无关标题",
          value: 10_000,
          delta_mom: 1,
          ytd: 2,
        }),
        metric("sa", {
          block_key: "cpf_acc_sa",
          title: "无关",
          value: 20_000,
          delta_mom: 1,
          ytd: 2,
        }),
        metric("ma", {
          block_key: "cpf_acc_ma",
          title: "无关",
          value: 30_000,
          delta_mom: 1,
          ytd: 2,
        }),
        {
          id: "contrib",
          block_type: "list",
          sort_order: 4,
          payload: {
            block_key: "cpf_contrib",
            title: "本月缴存",
            items: [
              JSON.stringify({
                OA: 1,
                SA: 1,
                MA: 1,
                employer: 1,
                self: 2,
                total: 99,
                annual_limit: 100,
                paid_ytd: 10,
                limit_left: 90,
              }),
            ],
          },
          ...baseMeta,
        },
      ]),
    );
    expect(model.accounts?.balances).toEqual({
      OA: 10_000,
      SA: 20_000,
      MA: 30_000,
    });
    expect(model.accounts?.monthContribTotal).toBe(99);
    expect(model.contrib?.total).toBe(99);
  });

  it("falls back to title matching only among blocks without block_key", () => {
    const model = parseCpfModel(
      section([
        metric(
          "keyed-other",
          {
            block_key: "cpf_int_total",
            title: "普通户口 OA",
            value: 999,
          },
          0,
        ),
        metric(
          "oa",
          {
            title: "普通户口 OA",
            value: 11,
            delta_mom: 0,
            ytd: 0,
          },
          1,
        ),
        metric(
          "sa",
          { title: "特别户口 SA", value: 22, delta_mom: 0, ytd: 0 },
          2,
        ),
        metric(
          "ma",
          { title: "保健储蓄 MA", value: 33, delta_mom: 0, ytd: 0 },
          3,
        ),
      ]),
    );
    expect(model.accounts?.balances.OA).toBe(11);
    expect(model.accounts?.balances.SA).toBe(22);
    expect(model.accounts?.balances.MA).toBe(33);
  });

  it("does not match interest-titled metrics as account balances", () => {
    const model = parseCpfModel(
      section([
        metric("int-oa", { title: "利息 OA", value: 4556 }, 0),
        metric("int-sa", { title: "利息 SA", value: 2615 }, 1),
        metric("int-ma", { title: "利息 MA", value: 2566 }, 2),
        metric(
          "oa",
          {
            title: "普通户口 OA",
            value: 205_181,
            delta_mom: 1840,
            ytd: 18_400,
          },
          3,
        ),
        metric(
          "sa",
          {
            title: "特别户口 SA",
            value: 57_781,
            delta_mom: 480,
            ytd: 4_800,
          },
          4,
        ),
        metric(
          "ma",
          {
            title: "保健储蓄 MA",
            value: 72_613,
            delta_mom: 640,
            ytd: 5_900,
          },
          5,
        ),
      ]),
    );
    expect(model.accounts?.balances.OA).toBe(205_181);
    expect(model.accounts?.balances.SA).toBe(57_781);
    expect(model.accounts?.balances.MA).toBe(72_613);
    expect(model.annual?.interest.OA).toBe(4556);
  });

  it("reads conclusion by cpf_conclusion key", () => {
    const model = parseCpfModel(
      section([
        {
          id: "c",
          block_type: "text",
          sort_order: 0,
          payload: {
            block_key: "cpf_conclusion",
            title: "结论标题",
            text: "结论正文",
          },
          ...baseMeta,
        },
      ]),
    );
    expect(model.conclusion?.title).toBe("结论标题");
    expect(model.conclusion?.body).toBe("结论正文");
  });

  it("derives tier statuses from reached_tier / amounts", () => {
    const statuses = resolveRetirementStatuses({
      oaSa: 262_962,
      brs: 110_000,
      frs: 220_000,
      ers: 440_000,
      exceedFrs: 42_962,
      reachedTier: "FRS",
      nextEstimate: "2030 年 7 月",
    });
    expect(statuses.BRS.kind).toBe("reached");
    expect(statuses.FRS.kind).toBe("reached_over");
    expect(statuses.ERS.kind).toBe("next");
    expect(statuses.ERS.detail).toBe("2030 年 7 月");
  });

  it("ignores block_key when block_type does not match the slot", () => {
    const model = parseCpfModel(
      section([
        {
          id: "wrong-type-oa",
          block_type: "text",
          sort_order: 0,
          payload: {
            block_key: "cpf_acc_oa",
            title: "普通户口 OA",
            text: "wrong type should be ignored",
            value: 999_999,
          },
          ...baseMeta,
        },
        metric(
          "oa",
          {
            title: "普通户口 OA",
            value: 10,
            delta_mom: 0,
            ytd: 0,
          },
          1,
        ),
        metric(
          "sa",
          { title: "特别户口 SA", value: 20, delta_mom: 0, ytd: 0 },
          2,
        ),
        metric(
          "ma",
          { title: "保健储蓄 MA", value: 30, delta_mom: 0, ytd: 0 },
          3,
        ),
      ]),
    );
    expect(model.accounts?.balances.OA).toBe(10);
    expect(model.accounts?.balances.SA).toBe(20);
    expect(model.accounts?.balances.MA).toBe(30);
  });

  it("does not share one title-matched block across OA and SA slots", () => {
    const model = parseCpfModel(
      section([
        metric(
          "combined",
          {
            title: "OA 和 SA 合并",
            value: 50_000,
            delta_mom: 0,
            ytd: 0,
          },
          0,
        ),
        metric(
          "sa-real",
          {
            title: "特别户口 SA",
            value: 12_000,
            delta_mom: 0,
            ytd: 0,
          },
          1,
        ),
        metric(
          "ma",
          {
            title: "保健储蓄 MA",
            value: 8_000,
            delta_mom: 0,
            ytd: 0,
          },
          2,
        ),
      ]),
    );
    expect(model.accounts?.balances.OA).toBe(50_000);
    expect(model.accounts?.balances.SA).toBe(12_000);
    expect(model.accounts?.balances.MA).toBe(8_000);
  });
});

describe("CpfProgress zero denominators", () => {
  it("ratioPct returns 0 when target is 0 or non-finite", () => {
    expect(ratioPct(75_000, 0)).toBe(0);
    expect(ratioPct(75_000, Number.NaN)).toBe(0);
    expect(ratioPct(Number.POSITIVE_INFINITY, 100)).toBe(0);
    expect(ratioPct(50, 100)).toBe(50);
  });

  it("renders finite percents when BHS/ERS targets are 0", () => {
    const html = renderToStaticMarkup(
      createElement(CpfProgress, {
        data: {
          ma: 10_000,
          bhs: 0,
          oaSa: 50_000,
          brs: 0,
          frs: 0,
          ers: 0,
          exceedFrs: 0,
        },
      }),
    );
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("NaN");
    expect(html).toContain("已达 BHS");
    expect(html).toContain(">0%<");
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
