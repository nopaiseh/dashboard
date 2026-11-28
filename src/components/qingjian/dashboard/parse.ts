import { BLOCK_EMPTY_DEFAULT, chartEventLabel } from "./labels";
import { isSensitivePayloadKey } from "./format";
import type {
  ChartSeriesView,
  ChartViewEvent,
  ChartViewPoint,
  ListView,
  MetricView,
  ProgressTierMark,
  ProgressView,
  TextView,
} from "./types";

function asRecord(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (isSensitivePayloadKey(k)) continue;
    out[k] = v;
  }
  return out;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asEmptyText(payload: Record<string, unknown>): string | undefined {
  if (payload.empty === true || payload.status === "empty") {
    return asString(payload.empty_text) ?? asString(payload.empty) ?? BLOCK_EMPTY_DEFAULT;
  }
  if (typeof payload.empty === "string" && payload.empty.trim()) {
    return payload.empty.trim();
  }
  if (typeof payload.empty_text === "string" && payload.empty_text.trim()) {
    return payload.empty_text.trim();
  }
  return undefined;
}

export function parseMetricPayload(
  payload: Record<string, unknown>,
): MetricView | null {
  const p = asRecord(payload);
  const title = asString(p.title)?.trim();
  const value = asNumber(p.value);
  const emptyText = asEmptyText(p);
  if (emptyText && (value === undefined || title === undefined)) {
    return {
      title: title || "指标",
      value: value ?? 0,
      emptyText,
    };
  }
  if (!title || value === undefined) return null;
  return {
    title,
    value,
    unit: asString(p.unit),
    label: asString(p.label),
    deltaMom: asNumber(p.delta_mom) ?? asNumber(p.deltaMom),
    deltaLabel: asString(p.delta_label) ?? asString(p.deltaLabel),
    ytd: asNumber(p.ytd),
    ytdLabel: asString(p.ytd_label) ?? asString(p.ytdLabel),
  };
}

function parseTiers(raw: unknown): ProgressTierMark[] {
  if (!Array.isArray(raw)) return [];
  const out: ProgressTierMark[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const key = asString(row.key) ?? asString(row.id) ?? asString(row.label);
    const label = asString(row.label) ?? key;
    const amount = asNumber(row.amount) ?? asNumber(row.value);
    if (!key || !label || amount === undefined) continue;
    out.push({ key, label, amount });
  }
  return out.sort((a, b) => a.amount - b.amount);
}

export function parseProgressPayload(
  payload: Record<string, unknown>,
): ProgressView | null {
  const p = asRecord(payload);
  const title = asString(p.title)?.trim();
  const progress = asNumber(p.progress);
  const emptyText = asEmptyText(p);
  if (emptyText && (title === undefined || progress === undefined)) {
    return {
      title: title || "进度",
      progress: progress ?? 0,
      tiers: [],
      emptyText,
    };
  }
  if (!title || progress === undefined) return null;
  if (emptyText && asString(p.status) === "empty") {
    return {
      title,
      progress,
      tiers: [],
      emptyText,
    };
  }

  const nextYearRaw =
    asNumber(p.next_tier_year) ??
    asNumber(p.nextTierYear) ??
    asString(p.next_tier_year) ??
    asString(p.nextTierYear);

  return {
    title,
    progress,
    target: asString(p.target),
    metric: asString(p.metric),
    unit: asString(p.unit) ?? asString(p.metric),
    dueAt:
      p.due_at === null
        ? null
        : asString(p.due_at) ?? asString(p.dueAt) ?? undefined,
    status: asString(p.status),
    value: asNumber(p.value) ?? asNumber(p.current),
    tiers: parseTiers(p.tiers),
    reachedTier: asString(p.reached_tier) ?? asString(p.reachedTier),
    nextTier: asString(p.next_tier) ?? asString(p.nextTier),
    nextTierYear:
      nextYearRaw === undefined ? undefined : String(nextYearRaw),
    overshoot: asNumber(p.overshoot),
  };
}

export function parseListPayload(
  payload: Record<string, unknown>,
): ListView | null {
  const p = asRecord(payload);
  const emptyText = asEmptyText(p);
  const items = Array.isArray(p.items)
    ? p.items.filter((x): x is string => typeof x === "string")
    : [];
  if (emptyText && items.length === 0) {
    return { title: asString(p.title), items: [], emptyText };
  }
  if (!Array.isArray(p.items)) return null;
  return {
    title: asString(p.title),
    items,
    emptyText: items.length === 0 ? emptyText ?? BLOCK_EMPTY_DEFAULT : emptyText,
  };
}

export function parseTextPayload(
  payload: Record<string, unknown>,
): TextView | null {
  const p = asRecord(payload);
  const text = asString(p.text);
  const emptyText = asEmptyText(p);
  const missingYears = Array.isArray(p.missing_years)
    ? p.missing_years.filter((x): x is string => typeof x === "string")
    : Array.isArray(p.missingYears)
      ? p.missingYears.filter((x): x is string => typeof x === "string")
      : [];
  if (emptyText && (text === undefined || !text.trim())) {
    return {
      title: asString(p.title),
      text: "",
      emptyText,
      missingYears,
    };
  }
  if (text === undefined) return null;
  return {
    title: asString(p.title),
    text,
    emptyText: !text.trim() ? emptyText ?? BLOCK_EMPTY_DEFAULT : emptyText,
    missingYears,
  };
}

function inferGrain(t: string, explicit?: string): ChartViewPoint["grain"] {
  if (explicit === "year" || explicit === "month") return explicit;
  if (/^\d{4}$/.test(t.trim())) return "year";
  return "month";
}

function parseSeriesPoints(raw: unknown): ChartViewPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartViewPoint[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const t = asString(row.t)?.trim();
    const v = asNumber(row.v);
    if (!t || v === undefined) continue;
    const phaseRaw = asString(row.phase) ?? asString(row.kind);
    const phase =
      phaseRaw === "projected" || phaseRaw === "forecast" ? "projected" : "actual";
    const grain = inferGrain(t, asString(row.grain) ?? asString(row.granularity));
    out.push({ t, v, phase, grain });
  }
  return out;
}

function parseEvents(raw: unknown): ChartViewEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: ChartViewEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const t = asString(row.t)?.trim();
    const kindRaw = asString(row.kind) ?? asString(row.type) ?? "";
    if (!t || !kindRaw) continue;
    const kind =
      kindRaw === "lump_sum" || kindRaw === "lump-sum" || kindRaw === "flag"
        ? "lump_sum"
        : "employer_change";
    out.push({
      t,
      kind,
      label: chartEventLabel(kind, asString(row.label)),
    });
  }
  return out;
}

export function parseChartSeriesPayload(
  payload: Record<string, unknown>,
): ChartSeriesView | null {
  const p = asRecord(payload);
  const emptyText = asEmptyText(p);
  const series = parseSeriesPoints(p.series);
  const projected = parseSeriesPoints(p.projected).map((pt) => ({
    ...pt,
    phase: "projected" as const,
  }));
  const merged = [...series, ...projected];
  if (emptyText && merged.length === 0) {
    return {
      title: asString(p.title),
      series: [],
      events: [],
      emptyText,
      unit: asString(p.unit),
      defaultRange: "12m",
      allFromYear: 2016,
      projectionNote: false,
    };
  }
  if (!Array.isArray(p.series) && projected.length === 0) return null;

  const rangeRaw = asString(p.range_default) ?? asString(p.defaultRange);
  const allFrom =
    asNumber(p.all_from_year) ??
    asNumber(p.allFromYear) ??
    (asString(p.all_from)?.slice(0, 4)
      ? Number(asString(p.all_from)!.slice(0, 4))
      : undefined);

  const hasProjected = merged.some((pt) => pt.phase === "projected");

  return {
    title: asString(p.title),
    series: merged,
    events: parseEvents(p.events),
    emptyText:
      merged.length === 0 ? emptyText ?? BLOCK_EMPTY_DEFAULT : emptyText,
    unit: asString(p.unit),
    defaultRange: rangeRaw === "all" ? "all" : "12m",
    allFromYear: allFrom && Number.isFinite(allFrom) ? allFrom : 2016,
    projectionNote:
      p.projection_note === false || p.projectionNote === false
        ? false
        : hasProjected,
  };
}
