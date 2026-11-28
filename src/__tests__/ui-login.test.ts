import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { LoginForm } from "@/components/qingjian/LoginForm";

describe("login UI (registration removed)", () => {
  it("LoginForm shows passkey CTA without setup / 首次注册 link", () => {
    const html = renderToStaticMarkup(
      createElement(LoginForm, { siteName: "玄机阁" }),
    );
    expect(html).toContain("使用通行密钥登录");
    expect(html).toContain("玄机阁");
    expect(html).not.toContain('href="/setup"');
    expect(html).not.toContain("首次注册");
    expect(html).not.toContain("style=");
  });
});

describe("login page", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("LoginPage renders passkey login without setup entry", async () => {
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => "测试阁",
    }));

    const { default: LoginPage } = await import("@/app/login/page");
    const element = await LoginPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("测试阁");
    expect(html).toContain("使用通行密钥登录");
    expect(html).not.toContain('href="/setup"');
    expect(html).not.toContain("首次注册");
  });

  it("LoginPage still renders when env helpers throw", async () => {
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => {
        throw new Error("Missing required environment variable: SITE_NAME");
      },
    }));

    const { default: LoginPage } = await import("@/app/login/page");
    const element = await LoginPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("玄机阁");
    expect(html).toContain("使用通行密钥登录");
    expect(html).not.toContain("首次注册");
  });
});
