import "server-only";

import { connection } from "next/server";

/** 阻止在 next build / 预渲染阶段执行需密钥的逻辑。 */
export async function requireRequest(): Promise<void> {
  // Vitest 直接调用 route handler，无 Next 请求作用域
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return;
  }
  await connection();
}
