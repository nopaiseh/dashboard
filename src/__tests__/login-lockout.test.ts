import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  anyLocked,
  clearedAttemptState,
  evaluateLoginLockout,
  isLocked,
  nextFailureState,
} from "@/lib/login-lockout";

describe("login lockout (centralized)", () => {
  it(`locks after ${LOGIN_MAX_FAILURES} consecutive failures for ${LOGIN_LOCK_MINUTES} minutes`, () => {
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

  it("evaluateLoginLockout locks on IP or credential, not global", () => {
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
    expect(
      evaluateLoginLockout(
        lockedIp,
        clearedAttemptState("credential", "cred-a"),
        now,
      ).locked,
    ).toBe(true);

    const lockedCred = nextFailureState(
      {
        scope: "credential",
        scope_key: "cred-a",
        failed_count: LOGIN_MAX_FAILURES - 1,
        locked_until: null,
      },
      "credential",
      "cred-a",
      now,
    );
    expect(
      evaluateLoginLockout(
        clearedAttemptState("ip", "9.9.9.9"),
        lockedCred,
        now,
      ).locked,
    ).toBe(true);

    // 全站「锁定」状态不进入决策（策略：只告警）
    expect(
      evaluateLoginLockout(
        clearedAttemptState("ip", "9.9.9.9"),
        clearedAttemptState("credential", "cred-a"),
        now,
      ).locked,
    ).toBe(false);

    expect(
      anyLocked(
        [
          clearedAttemptState("ip", "9.9.9.9"),
          clearedAttemptState("credential", "cred-a"),
        ],
        now,
      ),
    ).toBe(false);
  });

  it("IP and credential counters are independent", () => {
    const now = new Date("2025-06-01T12:00:00.000Z");
    let ip = null;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      ip = nextFailureState(ip, "ip", "1.1.1.1", now);
    }
    expect(isLocked(ip, now)).toBe(true);

    let cred = null;
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i += 1) {
      cred = nextFailureState(cred, "credential", "cred-x", now);
    }
    expect(isLocked(cred, now)).toBe(false);
    expect(evaluateLoginLockout(ip, cred, now).locked).toBe(true);
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

  it("recordLoginFailure alerts on global_alert without treating as lock alone", async () => {
    vi.doMock("server-only", () => ({}));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { recordLoginFailure } = await import("@/lib/login-service");
    const supabase = {
      rpc: async () => ({
        data: { locked: false, global_count: 5, global_alert: true },
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
