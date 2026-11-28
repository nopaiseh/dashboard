import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/components/qingjian/DashboardView";
import { CpfProgress } from "@/components/qingjian/dashboard/CpfProgress";
import { CpfSection } from "@/components/qingjian/dashboard/CpfSection";
import { StackedTrendChart } from "@/components/qingjian/dashboard/StackedTrendChart";
import {
  C2_BAL,
  C2_EXCEED_FRS,
  C2_HIT,
  C2_TOTAL,
} from "@/components/qingjian/dashboard/c2Data";
import {
  EMPTY_DASHBOARD,
  SAMPLE_DASHBOARD,
} from "@/components/qingjian/dashboard/fixtures";
import {
  isDashboardEmpty,
  sortSectionsForView,
} from "@/components/qingjian/dashboard/sortSections";
import { PROJECTION_NOTE } from "@/components/qingjian/dashboard/labels";

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
  it("renders nine-part layout with Chinese account labels and c2 numbers", () => {
    const html = renderToStaticMarkup(
      createElement(CpfSection, { sampleMode: true }),
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
  });

  it("progress uses thin SVG bar with aligned tier labels and overshoot hatch", () => {
    const html = renderToStaticMarkup(createElement(CpfProgress, {}));
    expect(html).toContain("k-progressSvg");
    expect(html).toContain("BRS");
    expect(html).toContain("FRS");
    expect(html).toContain("ERS");
    expect(html).toContain("现在 → 下一档");
    expect(html).toContain("c2-over-");
  });

  it("chart exposes keyboard-operable range tabs and stacked series", () => {
    const html = renderToStaticMarkup(createElement(StackedTrendChart, {}));
    expect(html).toContain('role="tablist"');
    expect(html).toContain("近 12 个月");
    expect(html).toContain("全部（2016 年起）");
    expect(html).toContain("月底数");
    expect(html).toContain(C2_COLORS_CHECK);
  });
});

const C2_COLORS_CHECK = "#a9c9b6";

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
    // 缺年斜纹只作为图内样式说明出现在估算文案，不单独成块
    expect(html).not.toContain("k-yearGap");
    expect(html).not.toContain("style=");
  });

  it("production mode does not show sample banner", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: SAMPLE_DASHBOARD,
        sampleMode: false,
      }),
    );
    // c2_layout role still triggers CpfSection, but no top banner
    expect(html).not.toContain("此页所有数字、日期均为设计稿占位");
    expect(html).toContain("普通户口 OA");
  });

  it("renders calm page empty state without headline", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, { data: EMPTY_DASHBOARD }),
    );
    expect(html).toContain("暂无看板内容");
    expect(html).not.toContain("一句话结论");
  });

  it("overdue todo is marked and irreversible badge present", () => {
    const html = renderToStaticMarkup(createElement(CpfSection, {}));
    expect(html).toContain("k-late");
    expect(html).toContain("k-badgeRed");
    expect(html).toContain("不可逆");
  });
});
