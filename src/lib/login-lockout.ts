/**
 * 登录锁定逻辑集中于此。
 * 策略：只按 IP 失败达阈值后锁 15 分钟；
 * 凭据（credential）与全站（global）只计数告警，不参与锁定
 * （options 未登录可拿到凭据 ID，按凭据锁会被换 IP 锁死主人）。
 */

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_LOCK_MINUTES = 15;

export type LoginAttemptScope =
  | "ip"
  | "credential"
  | "global"
  | "auth_options"
  | "register_options";

export interface LoginAttemptState {
  scope: LoginAttemptScope;
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

/** IP 失败计数（可锁定）。credential / global 请用 nextAlertCountState。 */
export function nextFailureState(
  previous: LoginAttemptState | null | undefined,
  scope: "ip",
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

/**
 * 凭据 / 全站：只递增计数，达阈值归零并标记应告警，永不写 locked_until。
 */
export function nextAlertCountState(
  previous: LoginAttemptState | null | undefined,
  scope: "credential" | "global",
  scopeKey: string,
): { state: LoginAttemptState; alert: boolean } {
  const prevCount = previous?.failed_count && previous.failed_count > 0
    ? previous.failed_count
    : 0;
  const failedCount = prevCount + 1;
  if (failedCount >= LOGIN_MAX_FAILURES) {
    return {
      state: {
        scope,
        scope_key: scopeKey,
        failed_count: 0,
        locked_until: null,
      },
      alert: true,
    };
  }
  return {
    state: {
      scope,
      scope_key: scopeKey,
      failed_count: failedCount,
      locked_until: null,
    },
    alert: false,
  };
}

export function clearedAttemptState(
  scope: "ip" | "credential" | "global",
  scopeKey: string,
): LoginAttemptState {
  return {
    scope,
    scope_key: scopeKey,
    failed_count: 0,
    locked_until: null,
  };
}

/**
 * 集中入口：仅根据 IP 状态判断是否应拒绝本次登录尝试。
 * 凭据 / 全站计数不参与锁定（只告警）。
 */
export function evaluateLoginLockout(
  ipAttempt: LoginAttemptState | null | undefined,
  now: Date = new Date(),
): { locked: boolean; reason?: string } {
  if (isLocked(ipAttempt, now)) {
    return { locked: true, reason: "locked: too many failed login attempts" };
  }
  return { locked: false };
}
