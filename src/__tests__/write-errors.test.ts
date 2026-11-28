import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DASHBOARD_ISSUE_PATH_SEGMENT_MAX,
  DASHBOARD_ISSUE_PATH_SEGMENT_PLACEHOLDER,
  formatDashboardZodIssues,
} from "@/lib/dashboard/write-errors";

describe("formatDashboardZodIssues", () => {
  it("caps unrecognized_keys path segments over 64 chars with fixed placeholder", () => {
    const longKey = "k".repeat(5000);
    expect(longKey.length).toBe(5000);
    expect(longKey.length).toBeGreaterThan(DASHBOARD_ISSUE_PATH_SEGMENT_MAX);

    const schema = z.object({ title: z.string() }).strict();
    const parsed = schema.safeParse({ title: "ok", [longKey]: 1 });
    expect(parsed.success).toBe(false);
    const issues = formatDashboardZodIssues(parsed.error!);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: DASHBOARD_ISSUE_PATH_SEGMENT_PLACEHOLDER,
      code: "unrecognized_keys",
      message: "多余字段",
    });
    expect(JSON.stringify(issues)).not.toContain(longKey);
    expect(issues[0]!.path.length).toBeLessThanOrEqual(
      DASHBOARD_ISSUE_PATH_SEGMENT_MAX,
    );
  });

  it("keeps short unrecognized_keys path segments verbatim", () => {
    const schema = z.object({ title: z.string() }).strict();
    const parsed = schema.safeParse({ title: "ok", extra: 1 });
    expect(parsed.success).toBe(false);
    expect(formatDashboardZodIssues(parsed.error!)).toEqual([
      { path: "extra", code: "unrecognized_keys", message: "多余字段" },
    ]);
  });

  it("too_small numeric / length minimums → 低于下限 (not 缺少必填字段)", () => {
    const schema = z
      .object({
        value: z.number().min(0),
        title: z.string().min(1),
      })
      .strict();

    const negative = schema.safeParse({ value: -1, title: "x" });
    expect(negative.success).toBe(false);
    expect(formatDashboardZodIssues(negative.error!)).toEqual([
      { path: "value", code: "too_small", message: "低于下限" },
    ]);

    const empty = schema.safeParse({ value: 1, title: "" });
    expect(empty.success).toBe(false);
    expect(formatDashboardZodIssues(empty.error!)).toEqual([
      { path: "title", code: "too_small", message: "低于下限" },
    ]);
  });

  it("missing required still → 缺少必填字段 via invalid_type", () => {
    const schema = z.object({ title: z.string() }).strict();
    const parsed = schema.safeParse({});
    expect(parsed.success).toBe(false);
    expect(formatDashboardZodIssues(parsed.error!)).toEqual([
      { path: "title", code: "invalid_type", message: "缺少必填字段" },
    ]);
  });
});
