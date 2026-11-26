import { describe, expect, it } from "vitest";
import {
  decisionActionsBlocked,
  DECRYPT_FAILED_DECISION_REASON,
} from "@/lib/ui/decision-disabled";

describe("decisionActionsBlocked", () => {
  it("blocks when decrypt_failed", () => {
    expect(decisionActionsBlocked({ decrypt_failed: true })).toEqual({
      blocked: true,
      reason: DECRYPT_FAILED_DECISION_REASON,
    });
  });

  it("allows when decrypt succeeded", () => {
    expect(decisionActionsBlocked({})).toEqual({
      blocked: false,
      reason: null,
    });
    expect(decisionActionsBlocked({ decrypt_failed: false })).toEqual({
      blocked: false,
      reason: null,
    });
  });
});
