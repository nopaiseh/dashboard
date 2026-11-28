import { describe, expect, it } from "vitest";
import {
  DASHBOARD_AMOUNT_MAX,
  DASHBOARD_AMOUNT_MIN,
  DASHBOARD_CHART_EVENTS_MAX,
  DASHBOARD_CHART_POINTS_MAX,
  DASHBOARD_EMPTY_TEXT_MAX,
  DASHBOARD_MISSING_YEARS_MAX,
  DASHBOARD_PROGRESS_MAX,
  DASHBOARD_PROGRESS_MIN,
  DASHBOARD_TIERS_MAX,
  DASHBOARD_YEAR_MAX,
  DASHBOARD_YEAR_MIN,
  createDashboardBlockSchema,
  dashboardPayloadSchemaFor,
} from "@/lib/validation";

const SECTION_ID = "11111111-1111-4111-8111-111111111111";

function parsePayload(
  blockType: Parameters<typeof dashboardPayloadSchemaFor>[0],
  payload: unknown,
) {
  return dashboardPayloadSchemaFor(blockType).safeParse(payload);
}

describe("dashboard payload CPF field relaxation", () => {
  it("accepts legacy metric / progress / list / text / chart payloads", () => {
    expect(
      parsePayload("metric", {
        title: "OA",
        value: 1000,
        unit: "SGD",
      }).success,
    ).toBe(true);
    expect(
      parsePayload("progress", {
        title: "FRS",
        progress: 0.8,
      }).success,
    ).toBe(true);
    expect(parsePayload("list", { items: ["a"] }).success).toBe(true);
    expect(parsePayload("text", { text: "hello" }).success).toBe(true);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1 }],
      }).success,
    ).toBe(true);
  });

  it("accepts metric delta_mom / ytd / empty_text", () => {
    expect(
      parsePayload("metric", {
        title: "OA",
        value: 12_345.67,
        delta_mom: 100.5,
        ytd: -20,
        empty_text: "暂无余额",
      }).success,
    ).toBe(true);
  });

  it("rejects number out of money / progress range", () => {
    expect(
      parsePayload("metric", {
        title: "OA",
        value: DASHBOARD_AMOUNT_MAX + 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("metric", {
        title: "OA",
        value: DASHBOARD_AMOUNT_MIN - 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("metric", {
        title: "OA",
        value: 1,
        delta_mom: DASHBOARD_AMOUNT_MAX + 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("metric", {
        title: "OA",
        value: 1,
        ytd: Number.NaN,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: DASHBOARD_PROGRESS_MAX + 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: DASHBOARD_PROGRESS_MIN - 0.01,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        overshoot: DASHBOARD_AMOUNT_MAX + 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        tiers: [
          {
            key: "FRS",
            label: "FRS",
            amount: DASHBOARD_AMOUNT_MAX + 1,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: DASHBOARD_AMOUNT_MAX + 1 }],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid metric extras (type / oversize / unknown)", () => {
    expect(
      parsePayload("metric", {
        title: "OA",
        value: 1,
        delta_mom: "up",
      }).success,
    ).toBe(false);
    expect(
      parsePayload("metric", {
        title: "OA",
        value: 1,
        empty_text: "x".repeat(DASHBOARD_EMPTY_TEXT_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      parsePayload("metric", {
        title: "OA",
        value: 1,
        delta_label: "较上月",
      }).success,
    ).toBe(false);
  });

  it("accepts progress value / unit / tiers / integer next_tier_year", () => {
    expect(
      parsePayload("progress", {
        title: "SA+OA",
        progress: 1.1,
        value: 220_000,
        unit: "SGD",
        tiers: [
          { key: "BRS", label: "BRS", amount: 100_000 },
          { key: "FRS", label: "FRS", amount: 200_000 },
          { key: "ERS", label: "ERS", amount: 300_000 },
        ],
        reached_tier: "FRS",
        next_tier: "ERS",
        next_tier_year: 2028,
        overshoot: 20_000,
      }).success,
    ).toBe(true);
  });

  it("rejects year out of range and non-integer years", () => {
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        next_tier_year: DASHBOARD_YEAR_MIN - 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        next_tier_year: DASHBOARD_YEAR_MAX + 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        next_tier_year: "2027-03",
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        next_tier_year: "2028",
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        next_tier_year: 2028.5,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1 }],
        all_from_year: DASHBOARD_YEAR_MIN - 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1 }],
        all_from_year: DASHBOARD_YEAR_MAX + 1,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("text", {
        text: "ok",
        missing_years: [DASHBOARD_YEAR_MIN - 1],
      }).success,
    ).toBe(false);
    expect(
      parsePayload("text", {
        text: "ok",
        missing_years: [DASHBOARD_YEAR_MAX + 1],
      }).success,
    ).toBe(false);
    expect(
      parsePayload("text", {
        text: "ok",
        missing_years: ["2020"],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid progress extras", () => {
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        value: "100",
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        tiers: [{ key: "FRS", label: "FRS" }],
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        tiers: Array.from({ length: DASHBOARD_TIERS_MAX + 1 }, (_, i) => ({
          key: `t${i}`,
          label: `T${i}`,
          amount: i,
        })),
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        reached_tier: "",
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        overshoot: Number.POSITIVE_INFINITY,
      }).success,
    ).toBe(false);
  });

  it("accepts chart_series phase / grain / events / range fields", () => {
    expect(
      parsePayload("chart_series", {
        title: "余额走势",
        series: [
          { t: "2026-01", v: 1, phase: "actual", grain: "month" },
          { t: "2027", v: 2, phase: "projected", grain: "year" },
        ],
        events: [
          { t: "2025-06", kind: "employer_change", label: "换雇主" },
          { t: "2024-01", kind: "lump_sum" },
        ],
        all_from_year: 2016,
        range_default: "12m",
      }).success,
    ).toBe(true);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1 }],
        range_default: "all",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid chart_series extras", () => {
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1, phase: "forecast" }],
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1, grain: "week" }],
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1 }],
        events: [{ t: "2025-01", kind: "bonus" }],
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1 }],
        events: Array.from(
          { length: DASHBOARD_CHART_EVENTS_MAX + 1 },
          (_, i) => ({
            t: `2020-${String((i % 12) + 1).padStart(2, "0")}`,
            kind: "lump_sum" as const,
          }),
        ),
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: Array.from(
          { length: DASHBOARD_CHART_POINTS_MAX + 1 },
          (_, i) => ({
            t: `2000-${String((i % 12) + 1).padStart(2, "0")}`,
            v: Math.min(i, DASHBOARD_AMOUNT_MAX),
          }),
        ),
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1 }],
        range_default: "6m",
      }).success,
    ).toBe(false);
    expect(
      parsePayload("chart_series", {
        series: [{ t: "2026-01", v: 1 }],
        unit: "SGD",
      }).success,
    ).toBe(false);
  });

  it("accepts list/text empty_text and integer missing_years", () => {
    expect(
      parsePayload("list", {
        items: [],
        empty_text: "无提取",
        missing_years: [2019, 2020],
      }).success,
    ).toBe(true);
    expect(
      parsePayload("text", {
        text: "",
        empty_text: "本年未填补",
        missing_years: [2021],
      }).success,
    ).toBe(true);
  });

  it("rejects invalid list/text extras", () => {
    expect(
      parsePayload("list", {
        items: [],
        empty_text: "x".repeat(DASHBOARD_EMPTY_TEXT_MAX + 1),
      }).success,
    ).toBe(false);
    expect(
      parsePayload("text", {
        text: "ok",
        missing_years: Array.from(
          { length: DASHBOARD_MISSING_YEARS_MAX + 1 },
          (_, i) => 2000 + (i % 50),
        ),
      }).success,
    ).toBe(false);
  });

  it("still rejects unknown keys via .strict()", () => {
    expect(
      parsePayload("metric", {
        title: "OA",
        value: 1,
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("progress", {
        title: "x",
        progress: 1,
        empty: true,
      }).success,
    ).toBe(false);
    expect(
      parsePayload("headline", {
        text: "hi",
        empty_text: "nope",
      }).success,
    ).toBe(false);
    // Structural create schema defers payload .strict() to category-aware parse.
    expect(
      createDashboardBlockSchema.safeParse({
        section_id: SECTION_ID,
        block_type: "metric",
        payload: { title: "OA", value: 1, foo: 1 },
      }).success,
    ).toBe(true);
    expect(
      parsePayload("metric", { title: "OA", value: 1, foo: 1 }).success,
    ).toBe(false);
  });
});
