import { requireSessionOrRedirect } from "@/lib/auth-guard";

/** 会话读 cookie，无法进入静态壳；允许阻塞渲染。 */
export const instant = false;

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireSessionOrRedirect();
  return children;
}
