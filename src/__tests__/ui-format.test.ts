import { describe, expect, it } from "vitest";
import {
  formatDueDate,
  formatHeaderDate,
  formatShortDate,
  isHttpsUrl,
  progressPercent,
  sourceLinkLabel,
} from "@/lib/ui/format";

describe("ui format", () => {
  it("formats Singapore header date", () => {
    const d = new Date("2026-11-26T04:00:00.000Z");
    expect(formatHeaderDate(d)).toMatch(/11月26日/);
    expect(formatHeaderDate(d)).toContain("新加坡");
  });

  it("formats relative activity times", () => {
    const now = new Date("2026-11-26T12:00:00+08:00");
    expect(formatShortDate("2026-11-26T11:20:00+08:00", now)).toMatch(/^今天/);
    expect(formatShortDate("2026-11-25T21:14:00+08:00", now)).toMatch(/^昨天/);
    expect(formatDueDate("2026-11-26T23:00:00+08:00", now)).toBe("今天");
  });

  it("only treats https as clickable source urls", () => {
    expect(isHttpsUrl("https://example.com/path")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(sourceLinkLabel("https://example.com/monthly")).toBe("monthly");
  });

  it("normalizes progress to percent", () => {
    expect(progressPercent(0.7)).toBe(70);
    expect(progressPercent(55)).toBe(55);
    expect(progressPercent(-1)).toBe(0);
  });
});
