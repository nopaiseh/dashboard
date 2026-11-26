/**
 * 简易**进程内**内存限流。
 *
 * 局限（故意保留，本 PR 不加 DB 迁移）：
 * - 按实例/isolate 各自计数；Vercel Serverless 多实例与冷启动会重置桶，
 *   全局限流弱于单机。
 * - 仅适合骨架期防连刷；生产若需跨实例强限流，应换 Redis / 库表
 *   （登录与 register/options 已走 DB 限流）或 Vercel 防火墙。
 *
 * setup/request 与 setup/confirm 目前仍用本模块；见 docs/architecture.md。
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.resetAt - now) / 1000),
      ),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((existing.resetAt - now) / 1000),
    ),
  };
}

/** 测试用：清空桶。 */
export function resetRateLimits(): void {
  buckets.clear();
}
