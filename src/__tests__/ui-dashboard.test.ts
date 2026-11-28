import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/components/qingjian/DashboardView";
import { BlockRenderer } from "@/components/qingjian/dashboard/BlockRenderer";
import { ProgressBlock } from "@/components/qingjian/dashboard/ProgressBlock";
import { ChartSeriesBlock } from "@/components/qingjian/dashboard/ChartSeriesBlock";
import {
  EMPTY_DASHBOARD,
  SAMPLE_DASHBOARD,
} from "@/components/qingjian/dashboard/fixtures";
import { filterSeriesByRange } from "@/components/qingjian/dashboard/chartRange";
import { progressCaption, progressFill } from "@/components/qingjian/dashboard/format";
import {
  parseChartSeriesPayload,
  parseMetricPayload,
  parseProgressPayload,
} from "@/components/qingjian/dashboard/parse";
import {
  isDashboardEmpty,
  sortSectionsForView,
} from "@/components/qingjian/dashboard/sortSections";
import { PROJECTION_NOTE } from "@/components/qingjian/dashboard/labels";
import type { DashboardBlockPublic } from "@/lib/dashboard/types";

const NOW = "2026-11-28T00:00:00.000Z";

function makeBlock(
  partial: Pick<
    DashboardBlockPublic,
    "id" | "section_id" | "block_type" | "sort_order" | "payload"
  >,
): DashboardBlockPublic {
  return {
    agent_id: null,
    created_at: NOW,
    updated_at: NOW,
    ...partial,
  };
}

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

describe("dashboard progress helpers", () => {
  it("allows overshoot beyond 100% with striped band math", () => {
    const fill = progressFill(1.12);
    expect(fill.withinPct).toBe(100);
    expect(fill.overshootPct).toBeGreaterThan(0);
    expect(fill.ratio).toBeCloseTo(1.12);
  });

  it("builds 已达 FRS / 下一档 ERS caption", () => {
    const caption = progressCaption({
      reachedTier: "FRS",
      overshoot: 12400,
      nextTier: "ERS",
      nextTierYear: "2038",
      unit: "S$",
    });
    expect(caption).toContain("已达 FRS");
    expect(caption).toContain("超出");
    expect(caption).toContain("下一档 ERS");
    expect(caption).toContain("2038");
  });
});

describe("dashboard chart range", () => {
  it("defaults filtering to recent window vs all-from-2016", () => {
    const view = parseChartSeriesPayload(
      SAMPLE_DASHBOARD.sections.find((s) => s.category === "cpf")!.blocks.find(
        (b) => b.block_type === "chart_series",
      )!.payload,
    )!;
    const now = new Date("2026-06-15T00:00:00+08:00");
    const recent = filterSeriesByRange(view.series, "12m", 2016, now);
    const all = filterSeriesByRange(view.series, "all", 2016, now);
    expect(all.length).toBeGreaterThan(recent.length);
    expect(all.some((p) => p.t === "2016")).toBe(true);
    expect(recent.some((p) => p.t === "2016")).toBe(false);
  });
});

describe("dashboard payload parsing", () => {
  it("reads metric delta / ytd extensions when present", () => {
    const view = parseMetricPayload({
      title: "OA",
      value: 100,
      unit: "S$",
      delta_mom: 12,
      ytd: 90,
    });
    expect(view?.deltaMom).toBe(12);
    expect(view?.ytd).toBe(90);
  });

  it("parses progress tiers and overshoot fields", () => {
    const view = parseProgressPayload({
      title: "对照",
      progress: 1.12,
      tiers: [
        { key: "BRS", label: "BRS", amount: 100 },
        { key: "FRS", label: "FRS", amount: 200 },
      ],
      reached_tier: "FRS",
      overshoot: 20,
      next_tier: "ERS",
      next_tier_year: 2038,
    });
    expect(view?.tiers).toHaveLength(2);
    expect(view?.reachedTier).toBe("FRS");
    expect(view?.overshoot).toBe(20);
  });

  it("strips sensitive keys from payload view", () => {
    const view = parseMetricPayload({
      title: "OA",
      value: 1,
      nric: "S1234567A",
      cpf_account: "123456789",
    });
    expect(view).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain("S1234567A");
    expect(JSON.stringify(view)).not.toContain("123456789");
  });
});

describe("dashboard UI rendering", () => {
  it("renders sample dashboard with pinned CPF and projection note", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: SAMPLE_DASHBOARD,
        sampleBanner: true,
      }),
    );
    expect(html).toContain("示例数据");
    expect(html).toContain("公积金");
    expect(html).toContain("旅行");
    expect(html.indexOf("公积金")).toBeLessThan(html.indexOf("旅行"));
    expect(html).toContain("本年未填补");
    expect(html).toContain("无提取");
    expect(html).toContain("该年暂无结算单");
    expect(html).toContain(PROJECTION_NOTE);
    expect(html).toContain("近 12 个月");
    expect(html).toContain("全部（2016 年起）");
    expect(html).not.toContain("style=");
  });

  it("renders calm page empty state", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, { data: EMPTY_DASHBOARD }),
    );
    expect(html).toContain("暂无看板内容");
    expect(html).not.toContain("qj-dashHeadline");
  });

  it("hides headline when empty string", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: { headline: "   ", sections: [] },
      }),
    );
    expect(html).not.toContain("dash-headline");
  });

  it("renders overshoot progress stripe markup", () => {
    const view = parseProgressPayload({
      title: "退休总和对照",
      progress: 1.12,
      unit: "S$",
      reached_tier: "FRS",
      overshoot: 12400,
      next_tier: "ERS",
      next_tier_year: 2038,
      tiers: [
        { key: "BRS", label: "BRS", amount: 106500 },
        { key: "FRS", label: "FRS", amount: 213000 },
        { key: "ERS", label: "ERS", amount: 426000 },
      ],
    })!;
    const html = renderToStaticMarkup(
      createElement(ProgressBlock, { view, blockId: "blk-progress" }),
    );
    expect(html).toContain("qj-dashProgressOver");
    expect(html).toContain("已达 FRS");
    expect(html).toContain("下一档 ERS");
  });

  it("renders chart range tabs as keyboard-operable tabs", () => {
    const view = parseChartSeriesPayload({
      title: "走势",
      series: [
        { t: "2026-01", v: 10 },
        { t: "2026-02", v: 12, phase: "projected" },
      ],
    })!;
    const html = renderToStaticMarkup(createElement(ChartSeriesBlock, { view }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("近 12 个月");
    expect(html).toContain("月底数");
  });

  it("BlockRenderer covers metric / list empty / decrypt failure", () => {
    const metric = renderToStaticMarkup(
      createElement(BlockRenderer, {
        block: makeBlock({
          id: "m1",
          section_id: "s",
          block_type: "metric",
          sort_order: 0,
          payload: { title: "利息合计", value: 100, unit: "S$" },
        }),
      }),
    );
    expect(metric).toContain("利息合计");

    const emptyList = renderToStaticMarkup(
      createElement(BlockRenderer, {
        block: makeBlock({
          id: "l1",
          section_id: "s",
          block_type: "list",
          sort_order: 0,
          payload: { title: "自愿填补", items: [], empty: "本年未填补" },
        }),
      }),
    );
    expect(emptyList).toContain("本年未填补");

    const failed = renderToStaticMarkup(
      createElement(BlockRenderer, {
        block: {
          ...makeBlock({
            id: "x",
            section_id: "s",
            block_type: "text",
            sort_order: 0,
            payload: {},
          }),
          decrypt_failed: true,
        },
      }),
    );
    expect(failed).toContain("暂无数据");
  });
});
