import { isDecisionValid } from "@/lib/content-hash";
import type { ItemEventRow, ItemRow } from "@/lib/types";

/**
 * 事项当前为 open，且存在一次批准事件的 content_hash 与现内容不一致
 * → 展示「内容已变更，原批准已失效」。
 */
export function hasInvalidatedApproval(
  item: Pick<ItemRow, "status" | "content_hash" | "kind">,
  events: Array<Pick<ItemEventRow, "action" | "content_hash">>,
): boolean {
  if (item.status !== "open") return false;
  if (item.kind !== "approval") return false;
  return events.some(
    (e) =>
      e.action === "approve" &&
      !isDecisionValid(e.content_hash, item.content_hash),
  );
}
