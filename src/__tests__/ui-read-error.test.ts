import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReadError } from "@/components/qingjian/ReadError";
import ProtectedError from "@/app/(protected)/error";
import ItemDetailError from "@/app/(protected)/items/[id]/error";

describe("ReadError boundary UI", () => {
  it("renders calm Chinese copy, retry control, and qingjian classes", () => {
    const html = renderToStaticMarkup(
      createElement(ReadError, { reset: () => undefined }),
    );
    expect(html).toContain("暂时读不到数据");
    expect(html).toContain("请稍后再试");
    expect(html).toContain("重试");
    expect(html).toContain("qj-error");
    expect(html).toContain("qj-errorRetry");
    expect(html).not.toContain("0 待批");
    expect(html).not.toContain("无未处理");
  });

  it("protected and item error.tsx boundaries render the same panel", () => {
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
    expect(protectedHtml).toContain("暂时读不到数据");
    expect(itemHtml).toContain("暂时读不到数据");
    expect(protectedHtml).toContain("重试");
    expect(itemHtml).toContain("重试");
  });
});
