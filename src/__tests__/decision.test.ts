import { describe, expect, it } from "vitest";
import { computeContentHash } from "@/lib/content-hash";
import {
  assertDecisionAllowed,
  decisionToStatus,
} from "@/lib/items-logic";
import { decisionSchema } from "@/lib/validation";

describe("decision API rules", () => {
  const options = [
    { key: "yes", label: "Yes" },
    { key: "no", label: "No" },
  ];
  const hash = computeContentHash({
    kind: "approval",
    title: "t",
    body: "b",
    options,
    source_url: null,
    due_at: null,
  });

  it("requires matching content_hash and open status", () => {
    expect(
      assertDecisionAllowed(
        "approval",
        "approve",
        "open",
        "yes",
        options,
        hash,
        hash,
      ).ok,
    ).toBe(true);

    expect(
      assertDecisionAllowed(
        "approval",
        "approve",
        "open",
        "yes",
        options,
        "0".repeat(64),
        hash,
      ).ok,
    ).toBe(false);

    expect(
      assertDecisionAllowed(
        "approval",
        "approve",
        "approved",
        "yes",
        options,
        hash,
        hash,
      ).ok,
    ).toBe(false);
  });

  it("enforces kind-specific actions and option_key membership", () => {
    expect(
      assertDecisionAllowed(
        "approval",
        "reply",
        "open",
        undefined,
        options,
        hash,
        hash,
      ).ok,
    ).toBe(false);

    expect(
      assertDecisionAllowed(
        "todo",
        "approve",
        "open",
        undefined,
        options,
        hash,
        hash,
      ).ok,
    ).toBe(false);

    expect(
      assertDecisionAllowed(
        "waiting",
        "reply",
        "open",
        undefined,
        options,
        hash,
        hash,
      ).ok,
    ).toBe(true);

    expect(
      assertDecisionAllowed(
        "approval",
        "approve",
        "open",
        "missing",
        options,
        hash,
        hash,
      ).ok,
    ).toBe(false);
  });

  it("decision schema is strict and requires content_hash", () => {
    const bad = decisionSchema.safeParse({
      action: "approve",
      assertion: {},
      challenge_id: "11111111-1111-4111-8111-111111111111",
      extra: true,
    });
    expect(bad.success).toBe(false);

    const good = decisionSchema.safeParse({
      action: "approve",
      content_hash: hash,
      assertion: { id: "cred" },
      challenge_id: "11111111-1111-4111-8111-111111111111",
      option_key: "yes",
    });
    expect(good.success).toBe(true);
    expect(decisionToStatus("approve")).toBe("approved");
  });
});
