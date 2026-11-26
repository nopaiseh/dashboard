/**
 * 将异步工作填充到最短墙钟时间，缩小时序差（如邮箱枚举）。
 * 仅作下限；OTP 网络往返通常远长于此。
 */
export async function ensureMinDuration(
  startedAtMs: number,
  minMs: number,
): Promise<void> {
  const elapsed = Date.now() - startedAtMs;
  if (elapsed < minMs) {
    await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
  }
}
