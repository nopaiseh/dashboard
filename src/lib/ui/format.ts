const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

/** 顶栏日期：11月26日 周四 · 新加坡 */
export function formatHeaderDate(
  date: Date = new Date(),
  timeZone = "Asia/Singapore",
): string {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);

  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const weekdayRaw = parts.find((p) => p.type === "weekday")?.value ?? "";
  const weekday = weekdayRaw.replace(/^周/, "") || WEEKDAYS[date.getDay()];
  return `${month}月${day}日 周${weekday} · 新加坡`;
}

export function formatShortDate(
  iso: string | null | undefined,
  now: Date = new Date(),
  timeZone = "Asia/Singapore",
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const sameDay = (a: Date, b: Date) =>
    formatYmd(a, timeZone) === formatYmd(b, timeZone);

  if (sameDay(d, now)) {
    return `今天 ${formatHm(d, timeZone)}`;
  }

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (sameDay(d, yesterday)) {
    return `昨天 ${formatHm(d, timeZone)}`;
  }

  const days = Math.floor((now.getTime() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days > 1 && days < 7) {
    return `${days} 天前`;
  }

  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${month}月${day}日`;
}

export function formatDueDate(
  iso: string | null | undefined,
  now: Date = new Date(),
  timeZone = "Asia/Singapore",
): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (formatYmd(d, timeZone) === formatYmd(now, timeZone)) {
    return "今天";
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${month}月${day}日`;
}

function formatYmd(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatHm(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** 来源链接展示名：取 hostname 或路径末段；仅 https 可点。 */
export function sourceLinkLabel(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : u.hostname;
  } catch {
    return url;
  }
}

export function isHttpsUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

export function progressPercent(progress: number | string | null | undefined): number {
  const n = typeof progress === "string" ? Number(progress) : Number(progress ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n <= 1) return Math.round(n * 100);
  return Math.min(100, Math.round(n));
}
