export const DASHBOARD_BLOCK_TYPES = [
  "headline",
  "metric",
  "progress",
  "list",
  "text",
  "chart_series",
] as const;

export type DashboardBlockType = (typeof DASHBOARD_BLOCK_TYPES)[number];

export type DashboardBlockAction = "create" | "update";

export interface DashboardSectionRow {
  id: string;
  category: string;
  sort_order: number;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardBlockRow {
  id: string;
  section_id: string;
  block_type: DashboardBlockType;
  sort_order: number;
  agent_id: string | null;
  /** AES-256-GCM envelope (or decrypted JSON string after read helpers). */
  payload: string;
  created_at: string;
  updated_at: string;
  decrypt_failed?: boolean;
}

/** Decrypted payload shapes (API / compute; never log). */
export type HeadlinePayload = { text: string };
export type TextPayload = { text: string; title?: string };
export type MetricPayload = {
  title: string;
  value: number;
  unit?: string;
  label?: string;
};
export type ProgressPayload = {
  title: string;
  target?: string;
  metric?: string;
  progress: number;
  due_at?: string | null;
  status?: string;
};
export type ListPayload = {
  title?: string;
  items: string[];
};
export type ChartSeriesPoint = { t: string; v: number };
export type ChartSeriesPayload = {
  title?: string;
  series: ChartSeriesPoint[];
};

export type DashboardPayload =
  | HeadlinePayload
  | TextPayload
  | MetricPayload
  | ProgressPayload
  | ListPayload
  | ChartSeriesPayload;

export interface DashboardBlockPublic {
  id: string;
  section_id: string;
  block_type: DashboardBlockType;
  sort_order: number;
  agent_id: string | null;
  /** Decrypted payload object; empty object if decrypt failed. */
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  decrypt_failed?: boolean;
}

export interface DashboardSectionPublic extends DashboardSectionRow {
  blocks: DashboardBlockPublic[];
}

/**
 * Owner read shape.
 * `headline` is empty string when no headline block exists — frontend may
 * fall back to default copy.
 */
export interface DashboardReadResult {
  headline: string;
  sections: DashboardSectionPublic[];
}
