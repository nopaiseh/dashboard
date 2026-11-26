import { describe, expect, it } from "vitest";
import {
  createItemSchema,
  patchItemSchema,
  registerOptionsSchema,
} from "@/lib/validation";

describe("input validation", () => {
  it("rejects non-https source_url and enforces datetime due_at", () => {
    expect(
      createItemSchema.safeParse({
        kind: "todo",
        title: "t",
        source_url: "http://insecure.example",
      }).success,
    ).toBe(false);

    expect(
      createItemSchema.safeParse({
        kind: "todo",
        title: "t",
        source_url: "https://ok.example/x",
        due_at: "not-a-date",
      }).success,
    ).toBe(false);

    expect(
      createItemSchema.safeParse({
        kind: "todo",
        title: "t",
        source_url: "https://ok.example/x",
        due_at: "2026-01-01T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects duplicate option keys, oversize lists, and unknown keys (.strict)", () => {
    expect(
      createItemSchema.safeParse({
        kind: "approval",
        title: "t",
        options: [
          { key: "a", label: "A" },
          { key: "a", label: "A2" },
        ],
      }).success,
    ).toBe(false);

    expect(
      createItemSchema.safeParse({
        kind: "approval",
        title: "t",
        unexpected: 1,
      }).success,
    ).toBe(false);

    expect(
      patchItemSchema.safeParse({
        status: "approved",
      }).success,
    ).toBe(false);

    expect(
      patchItemSchema.safeParse({
        status: "done",
      }).success,
    ).toBe(true);
  });

  it("requires registration token field", () => {
    expect(registerOptionsSchema.safeParse({}).success).toBe(false);
    expect(
      registerOptionsSchema.safeParse({ token: "x" }).success,
    ).toBe(true);
  });
});
