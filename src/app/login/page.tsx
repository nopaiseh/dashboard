import { connection } from "next/server";
import { getSiteName } from "@/lib/env";

/** 需动态渲染以接收 proxy 注入的 CSP nonce。 */
export const instant = false;

/**
 * 登录页：除站名外不透露其它内容。
 * 实际 passkey 交互由前端另做；此处仅占位。
 */
export default async function LoginPage() {
  await connection();

  let siteName = "玄机阁";
  try {
    siteName = getSiteName();
  } catch {
    siteName = "玄机阁";
  }

  return (
    <main className="mx-auto flex min-h-full w-full max-w-sm flex-1 flex-col items-center justify-center px-6 py-16">
      <h1 className="text-xl font-semibold tracking-tight">{siteName}</h1>
    </main>
  );
}
