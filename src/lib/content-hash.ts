import { sha256Hex } from "@/lib/crypto";
import type { ItemKind, ItemOption } from "@/lib/types";

/** Canonical options array (sorted by key) for stable hashing. */
export function canonicalizeOptions(
  options: ItemOption[] | unknown,
): ItemOption[] {
  const list = Array.isArray(options) ? options : [];
  return list
    .map((o) => {
      const row = o as ItemOption;
      return { key: String(row.key ?? ""), label: String(row.label ?? "") };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

export interface ContentHashFields {
  kind: ItemKind | string;
  title: string;
  body: string;
  options: ItemOption[] | unknown;
  source_url: string | null;
  due_at: string | null;
}

/**
 * content_hash = sha256(JSON.stringify([kind, title, body, options, source_url, due_at]))
 * 用 JSON 数组序列化避免拼接歧义；纳入 source_url / due_at / kind。
 */
export function computeContentHash(fields: ContentHashFields): string {
  const payload = JSON.stringify([
    fields.kind,
    fields.title,
    fields.body,
    canonicalizeOptions(fields.options),
    fields.source_url,
    fields.due_at,
  ]);
  return sha256Hex(payload);
}

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
