import { z } from "zod";

const uuidSchema = z.string().uuid();

/** 事项 / 姐妹 id 须为 UUID；非法则按「未找到」处理。 */
export function isValidUuid(id: string): boolean {
  return uuidSchema.safeParse(id).success;
}
