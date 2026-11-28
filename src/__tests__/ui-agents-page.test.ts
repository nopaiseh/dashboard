import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const refresh = vi.fn();
const usePathname = vi.fn(() => "/agents/agent-1");
const searchParamsGet = vi.fn<(key: string) => string | null>(() => null);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace }),
  usePathname: () => usePathname(),
  useSearchParams: () => ({
    get: (key: string) => searchParamsGet(key),
    toString: () => {
      const tab = searchParamsGet("tab");
      return tab ? `tab=${tab}` : "";
    },
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => createElement("a", { href, ...rest }, children),
}));

import { AgentDetailTabs } from "@/components/qingjian/AgentDetailTabs";
import { AgentTokensPanel } from "@/components/qingjian/AgentTokensPanel";
import { TopNav } from "@/components/qingjian/TopNav";
import { NAV_TABS } from "@/lib/ui/labels";
import type { AgentWithTokens } from "@/lib/owner-agent-tokens-types";

const SAMPLE_AGENTS: AgentWithTokens[] = [
  {
    id: "agent-a",
    slug: "alpha",
    name: "甲专员",
    area: "财务",
    bot_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    tokens: [
      {
        id: "tok-a",
        id_suffix: "aaaa",
        created_at: "2026-01-02T00:00:00.000Z",
        revoked_at: null,
        allowed_categories: ["cpf"],
      },
    ],
  },
  {
    id: "agent-b",
    slug: "beta",
    name: "乙专员",
    area: "行程",
    bot_id: null,
    created_at: "2026-01-01T00:00:00.000Z",
    tokens: [
      {
        id: "tok-b",
        id_suffix: "bbbb",
        created_at: "2026-01-03T00:00:00.000Z",
        revoked_at: null,
        allowed_categories: [],
      },
    ],
  },
];

describe("agents page nav + labels", () => {
  it("NAV_TABS uses /agents 专员 and drops settings/令牌", () => {
    expect(NAV_TABS.map((t) => ({ id: t.id, href: t.href, label: t.label }))).toEqual([
      { id: "today", href: "/", label: "今日" },
      { id: "pending", href: "/pending", label: "待批" },
      { id: "todo", href: "/todo", label: "待办" },
      { id: "waiting", href: "/waiting", label: "待回音" },
      { id: "held", href: "/held", label: "搁置" },
      { id: "agents", href: "/agents", label: "专员" },
    ]);
  });

  it("TopNav highlights 专员 and has no 令牌 entry", () => {
    const html = renderToStaticMarkup(
      createElement(TopNav, {
        active: "agents",
        counts: { approval: 0, todo: 0, waiting: 0, held: 0 },
        siteName: "青简",
      }),
    );
    expect(html).toContain("href=\"/agents\"");
    expect(html).toContain("专员");
    expect(html).toContain("aria-current=\"page\"");
    expect(html).not.toContain("/sisters");
    expect(html).not.toContain("/settings/agents");
    expect(html).not.toContain("令牌");
    expect(html).not.toContain("姐妹");
    expect(html).not.toContain("妻子");
  });
});

describe("AgentDetailTabs", () => {
  beforeEach(() => {
    replace.mockClear();
    usePathname.mockReturnValue("/agents/agent-1");
    searchParamsGet.mockImplementation(() => null);
  });

  it("renders accessible tablist with 事项 selected by default", () => {
    const html = renderToStaticMarkup(
      createElement(AgentDetailTabs, {
        itemsPanel: createElement("p", null, "事项内容"),
        tokensPanel: createElement("p", null, "令牌内容"),
      }),
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("事项");
    expect(html).toContain("令牌");
    expect(html).toContain("事项内容");
    expect(html).not.toContain("令牌内容");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
  });

  it("shows tokens panel when ?tab=tokens", () => {
    searchParamsGet.mockImplementation((key: string) =>
      key === "tab" ? "tokens" : null,
    );
    const html = renderToStaticMarkup(
      createElement(AgentDetailTabs, {
        itemsPanel: createElement("p", null, "事项内容"),
        tokensPanel: createElement("p", null, "令牌内容"),
      }),
    );
    expect(html).toContain("令牌内容");
    expect(html).not.toContain("事项内容");
  });
});

describe("AgentTokensPanel single-agent filter", () => {
  beforeEach(() => {
    refresh.mockClear();
  });

  it("only renders the requested agent tokens", () => {
    const html = renderToStaticMarkup(
      createElement(AgentTokensPanel, {
        initialAgents: SAMPLE_AGENTS,
        agentId: "agent-a",
      }),
    );
    expect(html).toContain("aaaa");
    expect(html).toContain("alpha");
    expect(html).not.toContain("bbbb");
    expect(html).not.toContain("乙专员");
    expect(html).not.toContain("新增专员");
    expect(html).not.toContain("姐妹");
    expect(html).toContain("该专员旧令牌");
  });

  it("lists all agents when agentId is omitted", () => {
    const html = renderToStaticMarkup(
      createElement(AgentTokensPanel, {
        initialAgents: SAMPLE_AGENTS,
      }),
    );
    expect(html).toContain("甲专员");
    expect(html).toContain("乙专员");
    expect(html).toContain("aaaa");
    expect(html).toContain("bbbb");
  });
});
