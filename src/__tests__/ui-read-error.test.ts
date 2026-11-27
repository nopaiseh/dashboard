import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const usePathname = vi.fn(() => "/pending");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => usePathname(),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => createElement("a", { href, ...rest }, children),
}));

import { ReadError, runErrorRetry } from "@/components/qingjian/ReadError";
import { ProtectedReadError } from "@/components/qingjian/ProtectedReadError";
import { AppShell } from "@/components/qingjian/AppShell";
import ProtectedError from "@/app/(protected)/error";
import ItemDetailError from "@/app/(protected)/items/[id]/error";
import { navTabFromPathname } from "@/lib/ui/labels";

describe("ReadError boundary UI", () => {
  beforeEach(() => {
    refresh.mockClear();
    usePathname.mockReturnValue("/pending");
  });

  it("renders calm Chinese copy, retry control, and qingjian classes", () => {
    const html = renderToStaticMarkup(
      createElement(ReadError, { reset: () => undefined }),
    );
    expect(html).toContain("暂时读不到数据");
    expect(html).toContain("请稍后再试");
    expect(html).toContain("重试");
    expect(html).toContain("qj-error");
    expect(html).toContain("qj-errorRetry");
    expect(html).not.toContain("<main");
    expect(html).not.toContain("0 待批");
    expect(html).not.toContain("无未处理");
  });

  it("runErrorRetry calls router.refresh then reset", () => {
    const reset = vi.fn();
    const order: string[] = [];
    const router = {
      refresh: () => {
        order.push("refresh");
        refresh();
      },
    };
    runErrorRetry(router, () => {
      order.push("reset");
      reset();
    });
    expect(order).toEqual(["refresh", "reset"]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("error boundaries keep AppShell top nav (single main)", () => {
    const reset = vi.fn();
    const protectedHtml = renderToStaticMarkup(
      createElement(ProtectedError, {
        error: Object.assign(new Error("boom"), { digest: "x" }),
        reset,
      }),
    );
    const itemHtml = renderToStaticMarkup(
      createElement(ItemDetailError, {
        error: Object.assign(new Error("boom"), { digest: "y" }),
        reset,
      }),
    );
    for (const html of [protectedHtml, itemHtml]) {
      expect(html).toContain("qj-app");
      expect(html).toContain("qj-top");
      expect(html).toContain("qj-brand");
      expect(html).toContain("暂时读不到数据");
      expect(html).toContain("重试");
      expect(html.match(/<main/g)?.length ?? 0).toBe(1);
    }
  });

  it("ProtectedReadError highlights tab from pathname", () => {
    usePathname.mockReturnValue("/todo");
    const html = renderToStaticMarkup(
      createElement(ProtectedReadError, { reset: () => undefined }),
    );
    expect(html).toContain("aria-current=\"page\"");
    expect(html).toContain("href=\"/todo\"");
  });
});

describe("AppShell landmark", () => {
  it("wraps content in a single main", () => {
    const html = renderToStaticMarkup(
      createElement(
        AppShell,
        {
          active: "today",
          counts: null,
          siteName: "玄机阁",
        } as ComponentProps<typeof AppShell>,
        createElement("p", null, "内容"),
      ),
    );
    expect(html).toContain("<main class=\"qj-wrap\"");
    expect(html.match(/<main/g)?.length ?? 0).toBe(1);
    expect(html).toContain("内容");
  });
});

describe("navTabFromPathname", () => {
  it("maps known routes", () => {
    expect(navTabFromPathname("/")).toBe("today");
    expect(navTabFromPathname("/pending")).toBe("pending");
    expect(navTabFromPathname("/sisters/abc")).toBe("sisters");
    expect(navTabFromPathname("/settings/agents")).toBe("settings");
    expect(navTabFromPathname("/items/abc")).toBe("today");
    expect(navTabFromPathname("/qa-out")).toBe("qa-out");
  });
});
