import { connection } from "next/server";
import Link from "next/link";

/** 404 须动态渲染，才能带上 proxy 注入的 CSP nonce（静态页脚本会失效）。 */
export const instant = false;

export default async function NotFound() {
  await connection();

  return (
    <main className={"qj-login"}>
      <div className={"qj-loginBox"}>
        <h1 className={"qj-loginBrand"}>未找到</h1>
        <p className={"qj-lockMsg"}>页面不存在或已移除。</p>
        <Link href="/" className={"qj-passkeyBtn"}>
          回到今日
        </Link>
      </div>
    </main>
  );
}
