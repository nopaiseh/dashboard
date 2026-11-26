export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

export interface LoginAttemptState {
  scope: "ip" | "global";
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

/**
 * 记录一次失败后的新状态。连续失败达到阈值则锁定 15 分钟。
 */
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

  // 若此前锁定已过期，从 0 重新累计
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

/** 登录成功后清零。 */
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
