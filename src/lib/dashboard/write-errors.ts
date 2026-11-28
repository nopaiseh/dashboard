import { jsonError } from "@/lib/http";
import type { NextResponse } from "next/server";

/** Generic client-facing error for schema or identifier rejection. */
export const DASHBOARD_INVALID_PAYLOAD_ERROR = "invalid payload";

/** Generic client-facing error when block_key is already used in the section. */
export const DASHBOARD_BLOCK_KEY_CONFLICT_ERROR = "conflict";

/**
 * HTTP 400 with body `{ error: "invalid payload" }` only.
 * No logging of matches, field paths, or raw payloads.
 */
export function dashboardInvalidPayloadResponse(): NextResponse {
  return jsonError(400, DASHBOARD_INVALID_PAYLOAD_ERROR);
}

/**
 * HTTP 409 with body `{ error: "conflict" }` only.
 * No payload contents or block_key values echoed.
 */
export function dashboardBlockKeyConflictResponse(): NextResponse {
  return jsonError(409, DASHBOARD_BLOCK_KEY_CONFLICT_ERROR);
}
