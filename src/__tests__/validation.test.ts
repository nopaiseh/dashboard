import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_ID_MAX,
  authVerifySchema,
  createItemSchema,
  kindValidationErrorMessage,
  patchItemSchema,
  registerOptionsSchema,
} from "@/lib/validation";

describe("input validation", () => {
  it("rejects removed question kinds with a clear message", () => {
    for (const kind of ["question_to_user", "question_from_user"] as const) {
      const parsed = createItemSchema.safeParse({ kind, title: "t" });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const msg = kindValidationErrorMessage(parsed.error);
        expect(msg).toContain(kind);
        expect(msg).toContain("has been removed");
      }
    }

    const ok = createItemSchema.safeParse({ kind: "todo", title: "t" });
    expect(ok.success).toBe(true);

    const patch = patchItemSchema.safeParse({ kind: "question_to_user" });
    expect(patch.success).toBe(false);
    if (!patch.success) {
      expect(kindValidationErrorMessage(patch.error)).toContain(
        "question_to_user",
      );
    }
  });

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

  it("requires invite token on register options", () => {
    expect(registerOptionsSchema.safeParse({}).success).toBe(false);
    expect(
      registerOptionsSchema.safeParse({ token: "x" }).success,
    ).toBe(true);
  });

  it(`caps credential id / rawId at ${CREDENTIAL_ID_MAX} chars`, () => {
    const challenge_id = "11111111-1111-4111-8111-111111111111";
    const okId = "a".repeat(CREDENTIAL_ID_MAX);
    const tooLong = "a".repeat(CREDENTIAL_ID_MAX + 1);

    expect(
      authVerifySchema.safeParse({
        challenge_id,
        assertion: { id: okId },
      }).success,
    ).toBe(true);

    expect(
      authVerifySchema.safeParse({
        challenge_id,
        assertion: { id: tooLong },
      }).success,
    ).toBe(false);

    expect(
      authVerifySchema.safeParse({
        challenge_id,
        assertion: { id: "short", rawId: tooLong },
      }).success,
    ).toBe(false);
  });
});
