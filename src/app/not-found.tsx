import { connection } from "next/server";

/** 404 须动态渲染，才能带上 proxy 注入的 CSP nonce（静态页脚本会失效）。 */
export const instant = false;

export default async function NotFound() {
  await connection();

  return (
    <main className="mx-auto flex min-h-full w-full max-w-sm flex-1 flex-col items-center justify-center gap-2 px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">未找到</h1>
      <p className="text-sm text-zinc-600">页面不存在或已移除。</p>
    </main>
  );
}
