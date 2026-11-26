import { describe, expect, it } from "vitest";
import { heldCutoffIso, isHeldItem } from "@/lib/ui/held";
import { hasInvalidatedApproval } from "@/lib/ui/invalidation";

describe("held items", () => {
  it("marks open items idle for 7+ days as held", () => {
    const now = new Date("2026-11-26T12:00:00.000Z");
    expect(
      isHeldItem("open", "2026-11-18T00:00:00.000Z", now),
    ).toBe(true);
    expect(
      isHeldItem("open", "2026-11-25T00:00:00.000Z", now),
    ).toBe(false);
    expect(
      isHeldItem("approved", "2026-11-01T00:00:00.000Z", now),
    ).toBe(false);
    expect(heldCutoffIso(now)).toBe("2026-11-19T12:00:00.000Z");
  });
});

describe("invalidated approval", () => {
  it("detects stale approve events against current content_hash", () => {
    expect(
      hasInvalidatedApproval(
        {
          status: "open",
          kind: "approval",
          content_hash: "aaa",
        },
        [{ action: "approve", content_hash: "bbb" }],
      ),
    ).toBe(true);

    expect(
      hasInvalidatedApproval(
        {
          status: "open",
          kind: "approval",
          content_hash: "aaa",
        },
        [{ action: "approve", content_hash: "aaa" }],
      ),
    ).toBe(false);

    expect(
      hasInvalidatedApproval(
        {
          status: "approved",
          kind: "approval",
          content_hash: "aaa",
        },
        [{ action: "approve", content_hash: "bbb" }],
      ),
    ).toBe(false);
  });
});
