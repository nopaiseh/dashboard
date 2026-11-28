import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    className?: string;
    "aria-label"?: string;
  }) => createElement("a", { href, ...rest }, children),
}));

import { DashboardDetailHeader } from "@/components/qingjian/DashboardDetailHeader";
import { DashboardOverview } from "@/components/qingjian/DashboardOverview";
import {
  OVERVIEW_BACK_LABEL,
  OVERVIEW_EMPTY_HINT,
  OVERVIEW_EMPTY_TITLE,
  OVERVIEW_PAGE_TITLE,
  boardConclusionSummary,
  buildBoardCards,
  findSectionByCategory,
} from "@/components/qingjian/dashboard/boardSummary";
import {
  EMPTY_DASHBOARD,
  SAMPLE_DASHBOARD,
} from "@/components/qingjian/dashboard/fixtures";
import type { DashboardSectionPublic } from "@/lib/dashboard/types";

const FIXED_NOW = new Date("2026-11-28T12:00:00+08:00");

describe("board summary helpers", () => {
  it("prefers cpf_conclusion block_key for one-line summary", () => {
    const section: DashboardSectionPublic = {
      id: "sec-example",
      category: "cpf",
      sort_order: 0,
      agent_id: null,
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-20T00:00:00.000Z",
      blocks: [
        {
          id: "blk-a",
          section_id: "sec-example",
          block_type: "text",
          sort_order: 0,
          agent_id: null,
          created_at: "2026-11-01T00:00:00.000Z",
          updated_at: "2026-11-20T00:00:00.000Z",
          payload: {
            block_key: "cpf_conclusion",
            title: "示例结论标题",
            text: "示例结论正文，仅供测试。",
          },
        },
        {
          id: "blk-b",
          section_id: "sec-example",
          block_type: "text",
          sort_order: 1,
          agent_id: null,
          created_at: "2026-11-01T00:00:00.000Z",
          updated_at: "2026-11-20T00:00:00.000Z",
          payload: { title: "其他说明", text: "不应优先" },
        },
      ],
    };
    expect(boardConclusionSummary(section)).toBe("示例结论标题");
  });

  it("builds card hrefs under /dashboard/[category] and pins cpf first", () => {
    const cards = buildBoardCards(SAMPLE_DASHBOARD.sections, FIXED_NOW);
    expect(cards.map((c) => c.category)).toEqual(["cpf", "travel"]);
    expect(cards[0].href).toBe("/dashboard/cpf");
    expect(cards[0].name).toBe("公积金");
    expect(cards[0].summary.length).toBeGreaterThan(0);
    expect(cards[0].updatedLabel).toMatch(/^更新于/);
    expect(cards[1].href).toBe("/dashboard/travel");
    expect(cards[1].name).toBe("旅行");
  });

  it("findSectionByCategory is case-insensitive and returns undefined for unknown", () => {
    expect(findSectionByCategory(SAMPLE_DASHBOARD.sections, "CPF")?.category).toBe(
      "cpf",
    );
    expect(findSectionByCategory(SAMPLE_DASHBOARD.sections, "unknown")).toBeUndefined();
  });
});

describe("dashboard overview grid", () => {
  it("renders a card per board with links to detail routes", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardOverview, {
        sections: SAMPLE_DASHBOARD.sections,
        now: FIXED_NOW,
      }),
    );
    expect(html).toContain(OVERVIEW_PAGE_TITLE);
    expect(html).toContain("qj-boardGrid");
    expect(html).toContain('href="/dashboard/cpf"');
    expect(html).toContain('href="/dashboard/travel"');
    expect(html).toContain("公积金");
    expect(html).toContain("旅行");
    expect(html).toContain("更新于");
    expect(html).not.toContain(OVERVIEW_EMPTY_TITLE);
  });

  it("shows friendly empty state when there are no boards", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardOverview, {
        sections: EMPTY_DASHBOARD.sections,
        now: FIXED_NOW,
      }),
    );
    expect(html).toContain(OVERVIEW_EMPTY_TITLE);
    expect(html).toContain(OVERVIEW_EMPTY_HINT);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("qj-boardCard");
    expect(html).not.toContain("/dashboard/");
  });
});

describe("dashboard detail back link", () => {
  it("links back to overview with 「← 全部看板」", () => {
    const html = renderToStaticMarkup(createElement(DashboardDetailHeader));
    expect(html).toContain(OVERVIEW_BACK_LABEL);
    expect(html).toContain('href="/"');
    expect(html).toContain("qj-dashBack");
  });
});
