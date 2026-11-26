/**
 * public/ 静态资源白名单（与仓库 public/ 目录一致）。
 * 扩展名放行仅限此集合，避免任意 *.ext 绕过鉴权。
 */
export const PUBLIC_STATIC_FILES: ReadonlySet<string> = new Set([
  "/file.svg",
  "/globe.svg",
  "/next.svg",
  "/vercel.svg",
  "/window.svg",
]);

export function isPublicStaticAsset(pathname: string): boolean {
  return PUBLIC_STATIC_FILES.has(pathname);
}
