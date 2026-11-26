/** 自定义 SQLSTATE：冲突（乐观锁 / 条件更新失败） */
export const PG_CONFLICT = "XJ409";
/** 自定义 SQLSTATE：禁止 */
export const PG_FORBIDDEN = "XJ403";
/** 自定义 SQLSTATE：未找到 */
export const PG_NOT_FOUND = "XJ404";

export interface RpcLikeError {
  code?: string | null;
  message?: string | null;
}

export function isPgConflict(error: RpcLikeError | null | undefined): boolean {
  return error?.code === PG_CONFLICT;
}

export function isPgForbidden(error: RpcLikeError | null | undefined): boolean {
  return error?.code === PG_FORBIDDEN;
}

export function isPgNotFound(error: RpcLikeError | null | undefined): boolean {
  return error?.code === PG_NOT_FOUND;
}
