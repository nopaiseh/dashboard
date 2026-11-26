import { describe, expect, it } from "vitest";
import {
  parseBackfillArgs,
  REHASH_EXECUTE_BLOCKED_MESSAGE,
} from "@/lib/crypto/backfill-cli";

describe("backfill CLI args", () => {
  it("allows --encrypt-only --execute", () => {
    const parsed = parseBackfillArgs(["--encrypt-only", "--execute"]);
    expect(parsed).toEqual({
      dryRun: false,
      batchSize: 100,
      mode: "encrypt",
    });
  });

  it("allows --rehash-only dry-run (default)", () => {
    const parsed = parseBackfillArgs(["--rehash-only"]);
    expect(parsed.mode).toBe("rehash");
    expect(parsed.dryRun).toBe(true);
  });

  it("rejects --rehash-only --execute", () => {
    expect(() => parseBackfillArgs(["--rehash-only", "--execute"])).toThrow(
      REHASH_EXECUTE_BLOCKED_MESSAGE,
    );
    try {
      parseBackfillArgs(["--rehash-only", "--execute"]);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("只允许 dry-run");
    }
  });

  it("requires exactly one mode flag", () => {
    expect(() => parseBackfillArgs([])).toThrow(/exactly one/);
    expect(() =>
      parseBackfillArgs(["--encrypt-only", "--rehash-only"]),
    ).toThrow(/exactly one/);
  });
});
