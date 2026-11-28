import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { DashboardView } from "@/components/qingjian/DashboardView";
import {
  OVERVIEW_BACK_LABEL,
  OVERVIEW_EMPTY_HINT,
  OVERVIEW_EMPTY_TITLE,
  OVERVIEW_PAGE_TITLE,
  boardConclusionSummary,
  boardConclusionSummaryFromSections,
  buildBoardCards,
  findSectionsByCategory,
  mergeSectionBlocks,
  normalizeCategory,
} from "@/components/qingjian/dashboard/boardSummary";
import { parseCpfModel } from "@/components/qingjian/dashboard/parseCpfModel";
import {
  EMPTY_DASHBOARD,
  SAMPLE_DASHBOARD,
} from "@/components/qingjian/dashboard/fixtures";
import type {
  DashboardBlockPublic,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";

const FIXED_NOW = new Date("2026-11-28T12:00:00+08:00");

function sectionStub(
  partial: Pick<DashboardSectionPublic, "id" | "category"> &
    Partial<DashboardSectionPublic>,
): DashboardSectionPublic {
  return {
    sort_order: 0,
    agent_id: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-20T00:00:00.000Z",
    blocks: [],
    ...partial,
  };
}

function textBlock(
  id: string,
  sectionId: string,
  payload: Record<string, unknown>,
  updatedAt = "2026-11-20T00:00:00.000Z",
): DashboardBlockPublic {
  return {
    id,
    section_id: sectionId,
    block_type: "text",
    sort_order: 0,
    agent_id: null,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: updatedAt,
    payload,
  };
}

describe("board summary helpers", () => {
  it("prefers cpf_conclusion block_key for one-line summary", () => {
    const section = sectionStub({
      id: "sec-example",
      category: "cpf",
      blocks: [
        textBlock("blk-a", "sec-example", {
          block_key: "cpf_conclusion",
          title: "示例结论标题",
          text: "示例结论正文，仅供测试。",
        }),
        textBlock("blk-b", "sec-example", {
          title: "其他说明",
          text: "不应优先",
        }),
      ],
    });
    expect(boardConclusionSummary(section)).toBe("示例结论标题");
  });

  it("builds one card per normalized category and pins cpf first", () => {
    const cards = buildBoardCards(SAMPLE_DASHBOARD.sections, FIXED_NOW);
    expect(cards.map((c) => c.category)).toEqual(["cpf", "travel"]);
    expect(cards[0].href).toBe("/dashboard/cpf");
    expect(cards[0].name).toBe("公积金");
    expect(cards[0].summary.length).toBeGreaterThan(0);
    expect(cards[0].updatedLabel).toMatch(/^更新于/);
    expect(cards[1].href).toBe("/dashboard/travel");
    expect(cards[1].name).toBe("旅行");
  });

  it("groups same-category sections (case variants) into one card", () => {
    const sections = [
      sectionStub({
        id: "sec-a",
        category: "CPF",
        agent_id: "00000000-0000-4000-8000-0000000000aa",
        updated_at: "2026-11-10T00:00:00.000Z",
        blocks: [
          textBlock("blk-old", "sec-a", { title: "旧结论" }, "2026-11-10T00:00:00.000Z"),
        ],
      }),
      sectionStub({
        id: "sec-b",
        category: "cpf",
        agent_id: "00000000-0000-4000-8000-0000000000bb",
        updated_at: "2026-11-25T00:00:00.000Z",
        blocks: [
          textBlock(
            "blk-new",
            "sec-b",
            {
              block_key: "cpf_conclusion",
              title: "跨分区结论标题",
              text: "正文",
            },
            "2026-11-25T00:00:00.000Z",
          ),
        ],
      }),
      sectionStub({
        id: "sec-travel",
        category: "travel",
        blocks: [
          {
            id: "blk-list",
            section_id: "sec-travel",
            block_type: "list",
            sort_order: 0,
            agent_id: null,
            created_at: "2026-11-01T00:00:00.000Z",
            updated_at: "2026-11-15T00:00:00.000Z",
            payload: { title: "行程备忘（示例）", items: ["京都"] },
          },
        ],
      }),
    ];
    const cards = buildBoardCards(sections, FIXED_NOW);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.category)).toEqual(["cpf", "travel"]);
    expect(cards[0].summary).toBe("跨分区结论标题");
    expect(cards[0].updatedIso).toBe("2026-11-25T00:00:00.000Z");
  });

  it("findSectionsByCategory matches case-insensitively without URI decoding", () => {
    const withPct = [
      sectionStub({ id: "sec-pct", category: "100%" }),
      sectionStub({ id: "sec-literal", category: "%41" }),
      ...SAMPLE_DASHBOARD.sections,
    ];
    expect(normalizeCategory("  CPF ")).toBe("cpf");
    expect(normalizeCategory("100%")).toBe("100%");
    expect(normalizeCategory("%41")).toBe("%41");
    // Next already decoded; treating '%41' as A would be wrong double-decode.
    expect(normalizeCategory("%41")).not.toBe("a");
    expect(findSectionsByCategory(withPct, "100%").map((s) => s.id)).toEqual([
      "sec-pct",
    ]);
    expect(findSectionsByCategory(withPct, "%41").map((s) => s.id)).toEqual([
      "sec-literal",
    ]);
    expect(findSectionsByCategory(SAMPLE_DASHBOARD.sections, "CPF")).toHaveLength(
      1,
    );
    expect(findSectionsByCategory(SAMPLE_DASHBOARD.sections, "unknown")).toEqual(
      [],
    );
  });

  it("finds cpf_conclusion across multiple matched CPF sections", () => {
    const conclusionOnly = sectionStub({
      id: "sec-conclusion",
      category: "cpf",
      agent_id: "00000000-0000-4000-8000-0000000000aa",
      blocks: [
        textBlock("blk-conclusion", "sec-conclusion", {
          block_key: "cpf_conclusion",
          title: "跨分区公积金结论",
          text: "仅在甲专员分区",
        }),
      ],
    });
    const otherBlocks = sectionStub({
      id: "sec-other",
      category: "CPF",
      agent_id: "00000000-0000-4000-8000-0000000000bb",
      blocks: [
        textBlock("blk-note", "sec-other", {
          title: "估算说明",
          text: "示例说明行",
        }),
      ],
    });
    expect(boardConclusionSummary(otherBlocks)).toBe("估算说明");
    expect(
      boardConclusionSummaryFromSections([otherBlocks, conclusionOnly]),
    ).toBe("跨分区公积金结论");

    const merged = mergeSectionBlocks([otherBlocks, conclusionOnly]);
    expect(merged).not.toBeNull();
    const model = parseCpfModel(merged!, "");
    expect(model.conclusion?.title).toBe("跨分区公积金结论");
    expect(model.conclusion?.body).toBe("仅在甲专员分区");

    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: { headline: "", sections: [otherBlocks, conclusionOnly] },
      }),
    );
    expect(html).toContain("跨分区公积金结论");
  });

  it("when two CPF sections share a block_key, lower section sort_order wins", () => {
    // Higher sort_order listed first on purpose — DashboardView sorts before merge.
    const laterSection = sectionStub({
      id: "sec-later",
      category: "cpf",
      sort_order: 10,
      agent_id: "00000000-0000-4000-8000-0000000000bb",
      created_at: "2026-11-02T00:00:00.000Z",
      blocks: [
        textBlock("blk-later", "sec-later", {
          block_key: "cpf_conclusion",
          title: "高排序分区结论（应被忽略）",
          text: "后写分区",
        }),
      ],
    });
    const earlierSection = sectionStub({
      id: "sec-earlier",
      category: "CPF",
      sort_order: 1,
      agent_id: "00000000-0000-4000-8000-0000000000aa",
      created_at: "2026-11-01T00:00:00.000Z",
      blocks: [
        textBlock("blk-earlier", "sec-earlier", {
          block_key: "cpf_conclusion",
          title: "低排序分区结论（应保留）",
          text: "先写分区",
        }),
      ],
    });

    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: {
          headline: "",
          sections: [laterSection, earlierSection],
        },
      }),
    );
    expect(html).toContain("低排序分区结论（应保留）");
    expect(html).not.toContain("高排序分区结论（应被忽略）");

    const cards = buildBoardCards([laterSection, earlierSection], FIXED_NOW);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.summary).toBe("低排序分区结论（应保留）");
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
    expect(html).not.toContain("aria-label=");
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

  it("uses unique normalized category keys when duplicate categories exist", () => {
    const sections = [
      sectionStub({ id: "a1", category: "cpf", agent_id: "aa" }),
      sectionStub({ id: "a2", category: "CPF", agent_id: "bb" }),
    ];
    const html = renderToStaticMarkup(
      createElement(DashboardOverview, { sections, now: FIXED_NOW }),
    );
    expect(html.match(/href="\/dashboard\/cpf"/g)?.length).toBe(1);
    expect(html).toContain("公积金");
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

describe("dashboard/[category] route notFound", () => {
  const notFound = vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  });

  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("next/navigation", () => ({
      notFound: () => notFound(),
    }));
    vi.doMock("next/link", () => ({
      default: ({
        children,
        href,
        ...rest
      }: {
        children: ReactNode;
        href: string;
      }) => createElement("a", { href, ...rest }, children),
    }));
    vi.doMock("@/lib/ui/page-helpers", () => ({
      withUiReadGuard: async <T>(work: () => Promise<T>) => work(),
      loadShellData: async () => ({
        siteName: "示例阁",
        counts: { approval: 0, todo: 0, waiting: 0, held: 0 },
      }),
    }));
  });

  it("calls notFound for unknown category", async () => {
    vi.doMock("@/lib/read", () => ({
      loadDashboard: async () => SAMPLE_DASHBOARD,
    }));
    const { default: Page } = await import(
      "@/app/(protected)/dashboard/[category]/page"
    );
    await expect(
      Page({ params: Promise.resolve({ category: "unknown-board" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("calls notFound for blank category", async () => {
    vi.doMock("@/lib/read", () => ({
      loadDashboard: async () => SAMPLE_DASHBOARD,
    }));
    const { default: Page } = await import(
      "@/app/(protected)/dashboard/[category]/page"
    );
    await expect(
      Page({ params: Promise.resolve({ category: "   " }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("renders when category matches (case-insensitive)", async () => {
    vi.doMock("@/lib/read", () => ({
      loadDashboard: async () => SAMPLE_DASHBOARD,
    }));
    const { default: Page } = await import(
      "@/app/(protected)/dashboard/[category]/page"
    );
    const tree = await Page({ params: Promise.resolve({ category: "CPF" }) });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(OVERVIEW_BACK_LABEL);
    expect(html).toContain("一句话结论");
    expect(notFound).not.toHaveBeenCalled();
  });
});
