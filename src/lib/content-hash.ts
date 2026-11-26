import { sha256Hex } from "@/lib/crypto";
import type { ItemOption } from "@/lib/types";

/** Canonical JSON for options so hash is stable across key order. */
export function canonicalizeOptions(options: ItemOption[] | unknown): string {
  const list = Array.isArray(options) ? options : [];
  const normalized = list
    .map((o) => {
      const row = o as ItemOption;
      return { key: String(row.key ?? ""), label: String(row.label ?? "") };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
  return JSON.stringify(normalized);
}

/**
 * content_hash = sha256(title + body + options)
 * 服务端唯一计算来源；姐妹改内容时必须重算。
 */
export function computeContentHash(
  title: string,
  body: string,
  options: ItemOption[] | unknown,
): string {
  const payload = `${title}\n${body}\n${canonicalizeOptions(options)}`;
  return sha256Hex(payload);
}

/**
 * 某次批准/拒绝/回复是否仍有效：事件记录的 content_hash 必须等于事项当前 hash。
 */
export function isDecisionValid(
  eventContentHash: string | null | undefined,
  currentContentHash: string,
): boolean {
  if (!eventContentHash) {
    return false;
  }
  return eventContentHash === currentContentHash;
}

export function annotateInvalidated<T extends { content_hash: string | null }>(
  event: T,
  currentContentHash: string,
): T & { invalidated: boolean } {
  return {
    ...event,
    invalidated: !isDecisionValid(event.content_hash, currentContentHash),
  };
}
