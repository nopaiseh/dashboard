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
  setupRegistrationErrorMessage,
} from "@/components/qingjian/SetupForm";
import { LoginForm } from "@/components/qingjian/LoginForm";
import { PasskeyError } from "@/lib/ui/passkey-client";

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

  it("LoginForm always shows neutral 首次注册 link (no registration-state leak)", () => {
    const html = renderToStaticMarkup(
      createElement(LoginForm, { siteName: "玄机阁" }),
    );
    expect(html).toContain('href="/setup"');
    expect(html).toContain("首次注册");
    expect(html).not.toContain("首次登记通行密钥");
    expect(html).not.toContain("已注册");
    expect(html).not.toContain("style=");
  });
});

describe("setupRegistrationErrorMessage", () => {
  it("shows neutral authenticator hint for NotAllowedError (not 已取消)", () => {
    const err = new Error("user cancelled or resident key unsupported");
    err.name = "NotAllowedError";
    expect(setupRegistrationErrorMessage(err)).toBe(
      "未完成登记，请确认使用支持通行密钥的认证器，或重试",
    );
    expect(setupRegistrationErrorMessage(err)).not.toBe("已取消");
    expect(setupRegistrationErrorMessage(err)).not.toContain("resident");
  });

  it("shows neutral message for NotSupportedError (no resident keys)", () => {
    const err = new Error("resident key not supported");
    err.name = "NotSupportedError";
    expect(setupRegistrationErrorMessage(err)).toBe(
      "注册未完成，请确认密码管理器支持通行密钥后重试",
    );
    expect(setupRegistrationErrorMessage(err)).not.toContain("resident");
    expect(setupRegistrationErrorMessage(err)).not.toContain("NotSupported");
  });

  it("shows 令牌无效或已失效 for token-rejected PasskeyError (403)", () => {
    const denied = new PasskeyError("registration denied", 403);
    expect(setupRegistrationErrorMessage(denied)).toBe("令牌无效或已失效");
    expect(setupRegistrationErrorMessage(denied)).not.toContain(
      "registration denied",
    );
    expect(setupRegistrationErrorMessage(denied)).not.toContain("403");
  });

  it("shows neutral message for other PasskeyError/failures without leaking details", () => {
    const passkey = new PasskeyError("secret server detail", 500);
    expect(setupRegistrationErrorMessage(passkey)).toBe(
      "注册未完成，请确认密码管理器支持通行密钥后重试",
    );
    expect(setupRegistrationErrorMessage(passkey)).not.toContain("secret");
    expect(setupRegistrationErrorMessage(passkey)).not.toContain("500");

    const generic = new Error("DOMException: InvalidStateError xyz");
    generic.name = "InvalidStateError";
    expect(setupRegistrationErrorMessage(generic)).toBe(
      "注册未完成，请确认密码管理器支持通行密钥后重试",
    );
    expect(setupRegistrationErrorMessage(generic)).not.toContain(
      "InvalidState",
    );
    expect(setupRegistrationErrorMessage("string blowup")).toBe(
      "注册未完成，请确认密码管理器支持通行密钥后重试",
    );
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

  it("LoginPage always shows 首次注册 and does not call hasWebAuthnCredential", async () => {
    const hasCredential = vi.fn(async () => {
      throw new Error("should not be called from /login");
    });
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => "测试阁",
    }));
    vi.doMock("@/lib/webauthn-credentials", () => ({
      hasWebAuthnCredential: hasCredential,
    }));

    const { default: LoginPage } = await import("@/app/login/page");
    const element = await LoginPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('href="/setup"');
    expect(html).toContain("首次注册");
    expect(html).toContain("测试阁");
    expect(hasCredential).not.toHaveBeenCalled();
  });

  it("LoginPage still renders when Supabase env would be missing", async () => {
    vi.doMock("next/server", () => ({
      connection: async () => undefined,
    }));
    vi.doMock("@/lib/env", () => ({
      getSiteName: () => {
        throw new Error("Missing required environment variable: SITE_NAME");
      },
    }));
    // Even if something imported hasWebAuthnCredential and it threw, login must not blank.
    vi.doMock("@/lib/webauthn-credentials", () => ({
      hasWebAuthnCredential: async () => {
        throw new Error("Missing required environment variable: SUPABASE_URL");
      },
    }));

    const { default: LoginPage } = await import("@/app/login/page");
    const element = await LoginPage();
    const html = renderToStaticMarkup(element);
    expect(html).toContain("玄机阁");
    expect(html).toContain("首次注册");
    expect(html).toContain("使用通行密钥登录");
  });
});
