import { describe, expect, it } from "vitest";
import {
  annotateInvalidated,
  computeContentHash,
  isDecisionValid,
} from "@/lib/content-hash";

describe("content_hash", () => {
  const base = {
    kind: "approval",
    title: "Approve me",
    body: "details",
    options: [{ key: "ok", label: "OK" }],
    source_url: null as string | null,
    due_at: null as string | null,
  };

  it("is stable for same fields and option key order", () => {
    const a = computeContentHash({
      ...base,
      options: [
        { key: "y", label: "Y" },
        { key: "x", label: "X" },
      ],
    });
    const b = computeContentHash({
      ...base,
      options: [
        { key: "x", label: "X" },
        { key: "y", label: "Y" },
      ],
    });
    expect(a).toBe(b);
  });

  it("changes when source_url, due_at, or kind changes", () => {
    const original = computeContentHash(base);
    expect(
      computeContentHash({ ...base, source_url: "https://example.com" }),
    ).not.toBe(original);
    expect(
      computeContentHash({ ...base, due_at: "2026-01-01T00:00:00.000Z" }),
    ).not.toBe(original);
    expect(computeContentHash({ ...base, kind: "todo" })).not.toBe(original);
  });

  it("marks prior approval invalid when content changes", () => {
    const original = computeContentHash(base);
    const changed = computeContentHash({
      ...base,
      body: "details CHANGED",
    });

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
