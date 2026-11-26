import { connection } from "next/server";

/** 与 layout 一致：全动态，避免 PPR 静态部分缺 nonce。 */
export const instant = false;

export default async function HomePage() {
  await connection();

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-3 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">玄机阁</h1>
      <p className="text-sm text-zinc-600">
        后端骨架已就绪。界面由前端另做；此处仅为占位。
      </p>
    </main>
  );
}
