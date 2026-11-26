/**
 * 登录锁定逻辑集中于此，便于日后改为「按 IP+凭据锁定、全站只报警」。
 * 当前策略（暂不改）：IP 与全站各自计数，连续失败 5 次锁 15 分钟。
 */

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

export interface LoginAttemptState {
  scope: "ip" | "global" | "auth_options";
  scope_key: string;
  failed_count: number;
  locked_until: string | null;
}

export function isLocked(
  attempt: LoginAttemptState | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!attempt?.locked_until) {
    return false;
  }
  return new Date(attempt.locked_until).getTime() > now.getTime();
}

export function nextFailureState(
  previous: LoginAttemptState | null | undefined,
  scope: "ip" | "global",
  scopeKey: string,
  now: Date = new Date(),
): LoginAttemptState {
  const stillLocked = isLocked(previous, now);
  if (stillLocked && previous) {
    return previous;
  }

  const baseCount =
    previous && !isLocked(previous, now) && previous.failed_count > 0
      ? previous.failed_count
      : 0;

  const failedCount =
    previous?.locked_until && !stillLocked ? 1 : baseCount + 1;

  const locked =
    failedCount >= LOGIN_MAX_FAILURES
      ? new Date(
          now.getTime() + LOGIN_LOCK_MINUTES * 60 * 1000,
        ).toISOString()
      : null;

  return {
    scope,
    scope_key: scopeKey,
    failed_count: failedCount >= LOGIN_MAX_FAILURES ? 0 : failedCount,
    locked_until: locked,
  };
}

export function clearedAttemptState(
  scope: "ip" | "global",
  scopeKey: string,
): LoginAttemptState {
  return {
    scope,
    scope_key: scopeKey,
    failed_count: 0,
    locked_until: null,
  };
}

export function anyLocked(
  attempts: Array<LoginAttemptState | null | undefined>,
  now: Date = new Date(),
): boolean {
  return attempts.some((a) => isLocked(a, now));
}

/**
 * 集中入口：根据 IP / 全站当前状态判断是否应拒绝本次登录尝试。
 * 日后改策略只动此函数（及 nextFailureState）。
 */
export function evaluateLoginLockout(
  ipAttempt: LoginAttemptState | null | undefined,
  globalAttempt: LoginAttemptState | null | undefined,
  now: Date = new Date(),
): { locked: boolean; reason?: string } {
  if (anyLocked([ipAttempt, globalAttempt], now)) {
    return { locked: true, reason: "locked: too many failed login attempts" };
  }
  return { locked: false };
}
