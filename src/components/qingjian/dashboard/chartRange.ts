import { parsePointTime } from "./format";
import type {
  ChartRangeMode,
  ChartViewEvent,
  ChartViewPoint,
} from "./types";

export function filterSeriesByRange(
  series: ChartViewPoint[],
  mode: ChartRangeMode,
  allFromYear: number,
  now: Date = new Date(),
): ChartViewPoint[] {
  const sorted = [...series].sort((a, b) => {
    const ta = parsePointTime(a.t) ?? 0;
    const tb = parsePointTime(b.t) ?? 0;
    return ta - tb;
  });

  if (mode === "all") {
    const from = Date.parse(`${allFromYear}-01-01T00:00:00+08:00`);
    return sorted.filter((pt) => {
      const t = parsePointTime(pt.t);
      return t == null || t >= from;
    });
  }

  const end = now.getTime();
  const start = new Date(now);
  start.setMonth(start.getMonth() - 12);
  const startMs = start.getTime();
  return sorted.filter((pt) => {
    const t = parsePointTime(pt.t);
    if (t == null) return true;
    return t >= startMs && t <= end + 86_400_000 * 370; // allow near-term projection
  });
}

export function filterEventsByRange(
  events: ChartViewEvent[],
  mode: ChartRangeMode,
  allFromYear: number,
  now: Date = new Date(),
): ChartViewEvent[] {
  const asPoints: ChartViewPoint[] = events.map((e) => ({
    t: e.t,
    v: 0,
    phase: "actual",
    grain: "month",
  }));
  const kept = new Set(
    filterSeriesByRange(asPoints, mode, allFromYear, now).map((p) => p.t),
  );
  return events.filter((e) => kept.has(e.t));
}

export function buildPolyline(
  points: Array<{ x: number; y: number }>,
): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
}
