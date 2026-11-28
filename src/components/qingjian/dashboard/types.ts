/**
 * Frontend view models for dashboard blocks.
 * Base shapes mirror `src/lib/dashboard/types.ts`.
 * Optional extended fields are parsed when present so UI can render richer
 * CPF/travel configs once the write API allows them — see PR backend checklist.
 */

export type ChartPointPhase = "actual" | "projected";
export type ChartPointGrain = "month" | "year";
export type ChartEventKind = "employer_change" | "lump_sum";
export type ChartRangeMode = "12m" | "all";

export interface ProgressTierMark {
  key: string;
  label: string;
  amount: number;
}

export interface ChartViewPoint {
  t: string;
  v: number;
  phase: ChartPointPhase;
  grain: ChartPointGrain;
}

export interface ChartViewEvent {
  t: string;
  kind: ChartEventKind;
  label: string;
}

export interface MetricView {
  title: string;
  value: number;
  unit?: string;
  label?: string;
  deltaMom?: number;
  deltaLabel?: string;
  ytd?: number;
  ytdLabel?: string;
  emptyText?: string;
}

export interface ProgressView {
  title: string;
  progress: number;
  target?: string;
  metric?: string;
  unit?: string;
  dueAt?: string | null;
  status?: string;
  value?: number;
  tiers: ProgressTierMark[];
  reachedTier?: string;
  nextTier?: string;
  nextTierYear?: string;
  overshoot?: number;
  emptyText?: string;
}

export interface ListView {
  title?: string;
  items: string[];
  emptyText?: string;
}

export interface TextView {
  title?: string;
  text: string;
  emptyText?: string;
  /** Years with no settlement statement — striped gap hint. */
  missingYears: string[];
}

export interface ChartSeriesView {
  title?: string;
  series: ChartViewPoint[];
  events: ChartViewEvent[];
  emptyText?: string;
  unit?: string;
  defaultRange: ChartRangeMode;
  allFromYear: number;
  projectionNote?: boolean;
}
