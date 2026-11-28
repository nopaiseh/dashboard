import { jsonError } from "@/lib/http";
import type { NextResponse } from "next/server";

/** Generic client-facing error for schema or identifier rejection. */
export const DASHBOARD_INVALID_PAYLOAD_ERROR = "invalid payload";

/**
 * HTTP 400 with body `{ error: "invalid payload" }` only.
 * No logging of matches, field paths, or raw payloads.
 */
export function dashboardInvalidPayloadResponse(): NextResponse {
  return jsonError(400, DASHBOARD_INVALID_PAYLOAD_ERROR);
}
