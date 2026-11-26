import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  clearedAttemptState,
  evaluateLoginLockout,
  isLocked,
  nextAlertCountState,
  nextFailureState,
} from "@/lib/login-lockout";

describe("login lockout (centralized)", () => {
  it(`locks IP after ${LOGIN_MAX_FAILURES} consecutive failures for ${LOGIN_LOCK_MINUTES} minutes`, () => {
    const now = new Date("2025-06-01T12:00:00.000Z");
    let state = null;
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i += 1) {
      state = nextFailureState(state, "ip", "1.2.3.4", now);
      expect(isLocked(state, now)).toBe(false);
    }
    state = nextFailureState(state, "ip", "1.2.3.4", now);
    expect(isLocked(state, now)).toBe(true);

    const stillLockedAt = new Date(
      now.getTime() + (LOGIN_LOCK_MINUTES - 1) * 60 * 1000,
    );
    expect(isLocked(state, stillLockedAt)).toBe(true);

    const unlockedAt = new Date(
      now.getTime() + (LOGIN_LOCK_MINUTES + 1) * 60 * 1000,
    );
    expect(isLocked(state, unlockedAt)).toBe(false);
  });

  it("evaluateLoginLockout only locks on IP, never credential/global", () => {
    const now = new Date("2025-06-01T12:00:00.000Z");
    const lockedIp = nextFailureState(
      {
        scope: "ip",
        scope_key: "9.9.9.9",
        failed_count: LOGIN_MAX_FAILURES - 1,
        locked_until: null,
      },
      "ip",
      "9.9.9.9",
      now,
    );
    expect(evaluateLoginLockout(lockedIp, now).locked).toBe(true);

    expect(
      evaluateLoginLockout(clearedAttemptState("ip", "9.9.9.9"), now).locked,
    ).toBe(false);

    // 即便凭据行带有历史 locked_until，决策入口也不再读它
    expect(
      evaluateLoginLockout(clearedAttemptState("ip", "1.1.1.1"), now).locked,
    ).toBe(false);
  });

  it("credential alert counting never sets locked_until; multi-IP fails do not lock credential", () => {
    let cred: ReturnType<typeof clearedAttemptState> | null = null;
    let alerts = 0;
    // 模拟换多个 IP 对同一凭据连续失败（远超阈值）
    for (let i = 0; i < LOGIN_MAX_FAILURES * 3; i += 1) {
      const result = nextAlertCountState(cred, "credential", "cred-owner");
      cred = result.state;
      if (result.alert) {
        alerts += 1;
      }
      expect(cred.locked_until).toBeNull();
      expect(isLocked(cred)).toBe(false);
    }
    expect(alerts).toBe(3);
    // IP 各自独立，未达阈值则 evaluate 不锁
    expect(
      evaluateLoginLockout(clearedAttemptState("ip", "10.0.0.1")).locked,
    ).toBe(false);
    expect(
      evaluateLoginLockout(clearedAttemptState("ip", "10.0.0.2")).locked,
    ).toBe(false);
  });

  it("global alert counting never locks", () => {
    let state = clearedAttemptState("global", "all");
    let alert = false;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      const r = nextAlertCountState(state, "global", "all");
      state = r.state;
      alert = r.alert;
    }
    expect(alert).toBe(true);
    expect(state.locked_until).toBeNull();
    expect(isLocked(state)).toBe(false);
  });
});

describe("login-service fail closed", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock("server-only");
  });

  it("assertNotLocked fails closed when loadAttempt DB errors", async () => {
    vi.doMock("server-only", () => ({}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { assertNotLocked } = await import("@/lib/login-service");
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: null,
                error: { message: "db down" },
              }),
            }),
          }),
        }),
      }),
    };

    const result = await assertNotLocked(supabase as never, "1.2.3.4");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("locked");
    }
    expect(errSpy).toHaveBeenCalled();
  });

  it("recordLoginFailure returns locked on RPC error", async () => {
    vi.doMock("server-only", () => ({}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { recordLoginFailure } = await import("@/lib/login-service");
    const supabase = {
      rpc: async () => ({ data: null, error: { message: "rpc failed" } }),
    };

    const result = await recordLoginFailure(
      supabase as never,
      "1.2.3.4",
      "cred-1",
    );
    expect(result.locked).toBe(true);
    expect(errSpy).toHaveBeenCalled();
  });

  it("recordLoginFailure alerts on credential_alert without locking", async () => {
    vi.doMock("server-only", () => ({}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { recordLoginFailure } = await import("@/lib/login-service");
    const supabase = {
      rpc: async () => ({
        data: {
          locked: false,
          global_count: 1,
          global_alert: false,
          credential_count: 5,
          credential_alert: true,
        },
        error: null,
      }),
    };

    const result = await recordLoginFailure(
      supabase as never,
      "1.2.3.4",
      "cred-owner",
    );
    expect(result.locked).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("credential login failure"),
      expect.any(Object),
    );
  });

  it("recordLoginFailure alerts on global_alert without treating as lock alone", async () => {
    vi.doMock("server-only", () => ({}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { recordLoginFailure } = await import("@/lib/login-service");
    const supabase = {
      rpc: async () => ({
        data: {
          locked: false,
          global_count: 5,
          global_alert: true,
          credential_count: 0,
          credential_alert: false,
        },
        error: null,
      }),
    };

    const result = await recordLoginFailure(supabase as never, "1.2.3.4");
    expect(result.locked).toBe(false);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("global login failure"),
      expect.any(Object),
    );
  });
});
