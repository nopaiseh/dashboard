/** 受保护布局已动态；显式声明避免静态壳缺 nonce。 */
export const instant = false;

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-3 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">玄机阁</h1>
      <p className="text-sm text-zinc-600">
        后端骨架已就绪。界面由前端另做；此处仅为占位。
      </p>
    </main>
  );
}
