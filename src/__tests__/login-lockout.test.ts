import { describe, expect, it } from "vitest";
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

  it("evaluateLoginLockout is the single decision entrypoint", () => {
    const now = new Date("2025-06-01T12:00:00.000Z");
    const locked = nextFailureState(
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
    const decision = evaluateLoginLockout(
      locked,
      clearedAttemptState("global", "all"),
      now,
    );
    expect(decision.locked).toBe(true);
    expect(
      anyLocked(
        [
          clearedAttemptState("ip", "9.9.9.9"),
          clearedAttemptState("global", "all"),
        ],
        now,
      ),
    ).toBe(false);
  });
});
