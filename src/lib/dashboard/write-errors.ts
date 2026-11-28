import { jsonError } from "@/lib/http";
import type { NextResponse } from "next/server";

/** Generic client-facing error for schema or identifier rejection. */
export const DASHBOARD_INVALID_PAYLOAD_ERROR = "invalid payload";

/**
 * HTTP 400 with body `{ error: "invalid payload" }` only.
 * Logs a generic reason — never the match, field path, or raw payload.
 */
export function dashboardInvalidPayloadResponse(): NextResponse {
  console.error("dashboard write rejected", { reason: "invalid_payload" });
  return jsonError(400, DASHBOARD_INVALID_PAYLOAD_ERROR);
}
