import { z } from "zod";

const itemIdSchema = z.string().uuid();

/** 事项 id 须为 UUID；非法则详情页应 notFound()。 */
export function isValidItemId(id: string): boolean {
  return itemIdSchema.safeParse(id).success;
}
