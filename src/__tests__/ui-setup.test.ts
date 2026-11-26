import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import {
  SetupAlreadyRegistered,
  SetupEmailForm,
  SetupPasskeyForm,
} from "@/components/qingjian/SetupForm";
import { LoginForm } from "@/components/qingjian/LoginForm";

describe("setup page UI states", () => {
  it("SetupEmailForm has one main, one h1, labeled email input", () => {
    const html = renderToStaticMarkup(
      createElement(SetupEmailForm, { siteName: "玄机阁" }),
    );
    expect(html.match(/<main/g)?.length ?? 0).toBe(1);
    expect(html.match(/<h1/g)?.length ?? 0).toBe(1);
    expect(html).toContain("玄机阁");
    expect(html).toContain("邮箱");
    expect(html).toContain("发送登录链接");
    expect(html).toContain('type="email"');
    expect(html).toContain("qj-login");
    expect(html).toContain("qj-setupInput");
    expect(html).not.toContain("BOOTSTRAP_TOKEN");
    expect(html).not.toContain("style=");
    expect(html).not.toContain("credential_id");
    expect(html).not.toContain("已注册");
  });

  it("SetupPasskeyForm shows register CTA without token input", () => {
    const html = renderToStaticMarkup(
      createElement(SetupPasskeyForm, { siteName: "玄机阁" }),
    );
    expect(html).toContain("登记通行密钥");
    expect(html).not.toContain("BOOTSTRAP_TOKEN");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("已注册");
  });

  it("SetupAlreadyRegistered shows only neutral 已注册 (no ids/counts)", () => {
    const html = renderToStaticMarkup(
      createElement(SetupAlreadyRegistered, { siteName: "玄机阁" }),
    );
    expect(html.match(/<main/g)?.length ?? 0).toBe(1);
    expect(html.match(/<h1/g)?.length ?? 0).toBe(1);
    expect(html).toContain("已注册");
    expect(html).not.toContain("BOOTSTRAP_TOKEN");
    expect(html).not.toContain("登记通行密钥");
    expect(html).not.toContain("credential");
    expect(html).not.toContain("count");
    expect(html).not.toContain("error");
    expect(html).not.toContain("style=");
  });

  it("LoginForm shows setup link only when showSetupLink is true", () => {
    const withLink = renderToStaticMarkup(
      createElement(LoginForm, {
        siteName: "玄机阁",
        showSetupLink: true,
      }),
    );
    expect(withLink).toContain('href="/setup"');
    expect(withLink).toContain("首次登记通行密钥");

    const withoutLink = renderToStaticMarkup(
      createElement(LoginForm, {
        siteName: "玄机阁",
        showSetupLink: false,
      }),
    );
    expect(withoutLink).not.toContain("/setup");
    expect(withoutLink).not.toContain("首次登记");
  });
});

describe("setup / login pages already-registered gating", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("SetupPage renders 已注册 when credential exists", async () => {
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => "测试阁",
    }));
    vi.doMock("@/lib/webauthn-credentials", () => ({
      hasWebAuthnCredential: async () => true,
    }));
    vi.doMock("@/lib/setup-grant", () => ({
      hasValidSetupGrant: async () => false,
    }));

    const { default: SetupPage } = await import("@/app/setup/page");
    const element = await SetupPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("已注册");
    expect(html).toContain("测试阁");
    expect(html).not.toContain("BOOTSTRAP_TOKEN");
    expect(html).not.toContain("credential_id");
  });

  it("SetupPage renders email form when no credential and no grant", async () => {
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => "测试阁",
    }));
    vi.doMock("@/lib/webauthn-credentials", () => ({
      hasWebAuthnCredential: async () => false,
    }));
    vi.doMock("@/lib/setup-grant", () => ({
      hasValidSetupGrant: async () => false,
    }));

    const { default: SetupPage } = await import("@/app/setup/page");
    const element = await SetupPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("邮箱");
    expect(html).toContain("发送登录链接");
    expect(html).not.toContain("BOOTSTRAP_TOKEN");
    expect(html).not.toContain("已注册");
  });

  it("SetupPage renders passkey form when grant is valid", async () => {
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => "测试阁",
    }));
    vi.doMock("@/lib/webauthn-credentials", () => ({
      hasWebAuthnCredential: async () => false,
    }));
    vi.doMock("@/lib/setup-grant", () => ({
      hasValidSetupGrant: async () => true,
    }));

    const { default: SetupPage } = await import("@/app/setup/page");
    const element = await SetupPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("登记通行密钥");
    expect(html).not.toContain("发送登录链接");
    expect(html).not.toContain("已注册");
  });

  it("LoginPage hides setup link when credential exists", async () => {
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => "测试阁",
    }));
    vi.doMock("@/lib/webauthn-credentials", () => ({
      hasWebAuthnCredential: async () => true,
    }));

    const { default: LoginPage } = await import("@/app/login/page");
    const element = await LoginPage();
    const html = renderToStaticMarkup(element);
    expect(html).not.toContain("/setup");
    expect(html).not.toContain("首次登记");
  });

  it("LoginPage shows setup link when no credential", async () => {
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => "测试阁",
    }));
    vi.doMock("@/lib/webauthn-credentials", () => ({
      hasWebAuthnCredential: async () => false,
    }));

    const { default: LoginPage } = await import("@/app/login/page");
    const element = await LoginPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/setup"');
    expect(html).toContain("首次登记通行密钥");
  });
});
