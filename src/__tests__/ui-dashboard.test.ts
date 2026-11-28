import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/components/qingjian/DashboardView";
import { CpfProgress } from "@/components/qingjian/dashboard/CpfProgress";
import { CpfSection } from "@/components/qingjian/dashboard/CpfSection";
import { StackedTrendChart } from "@/components/qingjian/dashboard/StackedTrendChart";
import { parseCpfModel } from "@/components/qingjian/dashboard/parseCpfModel";
import {
  C2_BAL,
  C2_EXCEED_FRS,
  C2_HIT,
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
    expect(html).toContain(C2_HIT.ERS);
    expect(html).toContain("已达 FRS");
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
    // 同一夹具 blocks 会解析出数字；横幅不出现。正式空数据见下例。
    expect(html).toContain("普通户口 OA");
    expect(html).not.toContain('class="banner"');
  });

  it("production c2 marker with empty/missing fields shows empties and no sample amounts", () => {
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
