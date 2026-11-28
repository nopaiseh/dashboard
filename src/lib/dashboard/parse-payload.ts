/**
 * Category-aware dashboard block payload parsing for agent writes.
 */

import { BANK_BLOCK_KEYS, isBankBlockKey } from "@/lib/bank-block-keys";
import { parseBankBlockPayload } from "@/lib/dashboard/bank-validation";
import {
  blockKeyPolicyCategory,
  isBlockKeyAllowedForCategory,
} from "@/lib/dashboard/block-key-policy";
import { parseTravelBlockPayload } from "@/lib/dashboard/travel-validation";
import { isTravelBlockKey } from "@/lib/travel-block-keys";
import {
  dashboardBlockTypeSchema,
  dashboardPayloadSchemaFor,
} from "@/lib/validation";
import type { z } from "zod";

type BlockType = z.infer<typeof dashboardBlockTypeSchema>;

export type DashboardPayloadParseResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error?: z.ZodError };

export type EarlyPayloadValidateResult =
  | { ok: true }
  | { ok: false; error?: z.ZodError };

/**
 * Fast-fail payload shape before the section row is loaded.
 * - bank block_key → strict bank schema
 * - travel block_key → strict travel schema
 * - otherwise → CPF-oriented schema (status quo for non-bank/travel keys / no key)
 * Category cross-checks still happen in `parseDashboardBlockPayload`.
 */
export function earlyValidateDashboardPayload(
  blockType: BlockType,
  payload: unknown,
): EarlyPayloadValidateResult {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return { ok: false };
  }
  const record = payload as Record<string, unknown>;
  const key = record.block_key;
  if (typeof key === "string" && isBankBlockKey(key)) {
    const parsed = parseBankBlockPayload(blockType, record, key);
    if (parsed.ok) return { ok: true };
    return { ok: false, error: parsed.error };
  }
  if (typeof key === "string" && isTravelBlockKey(key)) {
    const parsed = parseTravelBlockPayload(blockType, record, key);
    if (parsed.ok) return { ok: true };
    return { ok: false, error: parsed.error };
  }
  // Non-string / unknown keys fail the CPF-oriented enum here.
  const parsed = dashboardPayloadSchemaFor(blockType).safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }
  return { ok: true };
}

/**
 * - bank partition: strict bank schemas; block_key required and must be a bank key
 * - travel partition: strict travel schemas; block_key required and must be a travel key
 * - cpf / other: existing CPF-oriented schemas; block_key must pass category whitelist
 */
export function parseDashboardBlockPayload(
  blockType: BlockType,
  payload: unknown,
  category: string,
  options?: { requireBlockKey?: string },
): DashboardPayloadParseResult {
  const policy = blockKeyPolicyCategory(category);

  if (policy === "bank" || policy === "travel") {
    const keyFromPayload =
      typeof payload === "object" &&
      payload !== null &&
      "block_key" in payload &&
      typeof (payload as { block_key?: unknown }).block_key === "string"
        ? (payload as { block_key: string }).block_key
        : undefined;
    const blockKey = options?.requireBlockKey ?? keyFromPayload;
    if (!blockKey) {
      return { ok: false };
    }
    if (!isBlockKeyAllowedForCategory(category, blockKey)) {
      return { ok: false };
    }
    if (
      options?.requireBlockKey !== undefined &&
      keyFromPayload !== undefined &&
      keyFromPayload !== options.requireBlockKey
    ) {
      return { ok: false };
    }
    const withKey =
      keyFromPayload === blockKey
        ? payload
        : {
            ...(typeof payload === "object" && payload !== null
              ? (payload as Record<string, unknown>)
              : {}),
            block_key: blockKey,
          };
    if (policy === "bank") {
      return parseBankBlockPayload(blockType, withKey, blockKey);
    }
    return parseTravelBlockPayload(blockType, withKey, blockKey);
  }

  const parsed = dashboardPayloadSchemaFor(blockType).safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error };
  }
  const data = parsed.data as Record<string, unknown>;
  const blockKey =
    typeof data.block_key === "string" ? data.block_key : undefined;
  if (options?.requireBlockKey !== undefined) {
    if (blockKey !== options.requireBlockKey) {
      if (blockKey === undefined) {
        data.block_key = options.requireBlockKey;
      } else {
        return { ok: false };
      }
    }
  }
  const effectiveKey =
    typeof data.block_key === "string" ? data.block_key : undefined;
  if (!isBlockKeyAllowedForCategory(category, effectiveKey)) {
    return { ok: false };
  }
  if (
    policy === "cpf" &&
    effectiveKey !== undefined &&
    ((BANK_BLOCK_KEYS as readonly string[]).includes(effectiveKey) ||
      isTravelBlockKey(effectiveKey))
  ) {
    return { ok: false };
  }
  return { ok: true, data };
}
