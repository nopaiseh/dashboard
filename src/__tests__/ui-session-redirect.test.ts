import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

vi.mock("@/lib/env", () => ({
  getSiteName: () => "测试阁",
}));

describe("withUiReadGuard / loadShellData session redirect", () => {
  beforeEach(() => {
    vi.resetModules();
    redirect.mockClear();
  });

  it("withUiReadGuard redirects to /login on SessionRequiredError", async () => {
    const { SessionRequiredError } = await import("@/lib/read/errors");
    const { withUiReadGuard } = await import("@/lib/ui/page-helpers");

    await expect(
      withUiReadGuard(async () => {
        throw new SessionRequiredError("unauthorized");
      }),
    ).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });

  it("withUiReadGuard rethrows non-session errors", async () => {
    const { DataReadError } = await import("@/lib/read/errors");
    const { withUiReadGuard } = await import("@/lib/ui/page-helpers");

    await expect(
      withUiReadGuard(async () => {
        throw new DataReadError("db down");
      }),
    ).rejects.toBeInstanceOf(DataReadError);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("loadShellData redirects when loadCounts throws SessionRequiredError", async () => {
    vi.doMock("@/lib/read", async () => {
      const errors = await import("@/lib/read/errors");
      return {
        ...errors,
        loadCounts: async () => {
          throw new errors.SessionRequiredError("unauthorized");
        },
      };
    });

    const { loadShellData } = await import("@/lib/ui/page-helpers");
    await expect(loadShellData()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(redirect).toHaveBeenCalledWith("/login");
  });
});
