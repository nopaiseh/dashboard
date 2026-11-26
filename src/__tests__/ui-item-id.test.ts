import { describe, expect, it } from "vitest";
import { isValidUuid } from "@/lib/read";

/**
 * 详情页在进入数据读取前：非法 id → notFound()（真 404）。
 * 此处锁定与 validation.ts 一致的 zod uuid 判定。
 */
describe("item id 404 path", () => {
  it("accepts canonical UUID v4 strings", () => {
    expect(isValidUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isValidUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("rejects non-UUID ids that must 404", () => {
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("123")).toBe(false);
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("00000000-0000-0000-0000-00000000000")).toBe(false);
    expect(isValidUuid("gggggggg-gggg-gggg-gggg-gggggggggggg")).toBe(false);
  });

  it("maps invalid ids to the not-found branch used by items/[id]", () => {
    const decide = (id: string) =>
      isValidUuid(id) ? ("load" as const) : ("not-found" as const);
    expect(decide("pending-1")).toBe("not-found");
    expect(decide("abc")).toBe("not-found");
    expect(decide("00000000-0000-4000-8000-000000000001")).toBe("load");
  });
});
