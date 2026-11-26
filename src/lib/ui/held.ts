/** 搁置：open 且超过 holdDays 天无活动（与 stale_items 视图一致）。 */
export const HOLD_IDLE_DAYS = 7;

export function isHeldItem(
  status: string,
  lastActivityAt: string,
  now: Date = new Date(),
  holdDays = HOLD_IDLE_DAYS,
): boolean {
  if (status !== "open") return false;
  const t = Date.parse(lastActivityAt);
  if (Number.isNaN(t)) return false;
  return t < now.getTime() - holdDays * 24 * 60 * 60 * 1000;
}

export function heldCutoffIso(
  now: Date = new Date(),
  holdDays = HOLD_IDLE_DAYS,
): string {
  return new Date(now.getTime() - holdDays * 24 * 60 * 60 * 1000).toISOString();
}
