import { describe, expect, it } from "vitest";
import {
  annotateInvalidated,
  computeContentHash,
  isDecisionValid,
} from "@/lib/content-hash";

describe("content_hash invalidation", () => {
  it("is stable for same title/body/options", () => {
    const a = computeContentHash("t", "b", [
      { key: "y", label: "Y" },
      { key: "x", label: "X" },
    ]);
    const b = computeContentHash("t", "b", [
      { key: "x", label: "X" },
      { key: "y", label: "Y" },
    ]);
    expect(a).toBe(b);
  });

  it("marks prior approval invalid when content changes", () => {
    const original = computeContentHash("Approve me", "details", [
      { key: "ok", label: "OK" },
    ]);
    const changed = computeContentHash("Approve me", "details CHANGED", [
      { key: "ok", label: "OK" },
    ]);

    expect(isDecisionValid(original, original)).toBe(true);
    expect(isDecisionValid(original, changed)).toBe(false);

    const annotated = annotateInvalidated(
      {
        action: "approve",
        content_hash: original,
        credential_id: "cred-1",
        verified_at: "2025-01-01T00:00:00.000Z",
      },
      changed,
    );
    expect(annotated.invalidated).toBe(true);
  });
});
