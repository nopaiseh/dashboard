import { jsonError } from "@/lib/http";
import type { NextResponse } from "next/server";
import type { z } from "zod";

/** Generic client-facing error for schema or identifier rejection. */
export const DASHBOARD_INVALID_PAYLOAD_ERROR = "invalid payload";

/** Generic client-facing error when block_key is already used in the section. */
export const DASHBOARD_BLOCK_KEY_CONFLICT_ERROR = "conflict";

/** Cap zod issues returned to the client (DoS / noise guard). */
export const DASHBOARD_INVALID_PAYLOAD_ISSUES_MAX = 20;

export type DashboardPayloadIssue = {
  path: string;
  code: string;
  message: string;
};

/**
 * Fixed Chinese copy for zod issue codes. Never echo zod default messages
 * (they can include received / expected / input values).
 */
const ZOD_ISSUE_MESSAGE_ZH: Record<string, string> = {
  unrecognized_keys: "多余字段",
  invalid_type: "类型不对",
  invalid_value: "不在允许的取值内",
  too_big: "超出长度上限",
  too_small: "缺少必填字段",
  invalid_format: "格式不对",
};

const ZOD_ISSUE_FALLBACK_ZH = "校验未通过";

type ZodIssue = z.ZodError["issues"][number];

/** Missing required keys surface as invalid_type with "undefined" in zod's message. */
function isMissingRequiredIssue(issue: ZodIssue): boolean {
  return (
    issue.code === "invalid_type" &&
    typeof issue.message === "string" &&
    /\bundefined\b/.test(issue.message)
  );
}

function messageForIssue(issue: ZodIssue): string {
  if (isMissingRequiredIssue(issue)) {
    return "缺少必填字段";
  }
  return ZOD_ISSUE_MESSAGE_ZH[issue.code] ?? ZOD_ISSUE_FALLBACK_ZH;
}

function dottedPath(path: PropertyKey[]): string {
  return path.map(String).join(".");
}

/**
 * Map a ZodError to capped client issues: dotted path, zod code, fixed Chinese
 * message. For unrecognized_keys, append each offending key to the path.
 * Never includes received / input / expected / submitted values.
 */
export function formatDashboardZodIssues(
  error: z.ZodError,
): DashboardPayloadIssue[] {
  const out: DashboardPayloadIssue[] = [];
  for (const issue of error.issues) {
    if (out.length >= DASHBOARD_INVALID_PAYLOAD_ISSUES_MAX) break;

    if (issue.code === "unrecognized_keys") {
      const keys = issue.keys;
      for (const key of keys) {
        if (out.length >= DASHBOARD_INVALID_PAYLOAD_ISSUES_MAX) break;
        const base = dottedPath(issue.path);
        out.push({
          path: base ? `${base}.${key}` : key,
          code: "unrecognized_keys",
          message: ZOD_ISSUE_MESSAGE_ZH.unrecognized_keys!,
        });
      }
      continue;
    }

    out.push({
      path: dottedPath(issue.path),
      code: issue.code,
      message: messageForIssue(issue),
    });
  }
  return out;
}

/**
 * HTTP 400 with body `{ error: "invalid payload" }` only, or with capped
 * `issues` when a ZodError is provided. Privacy hits must call without error.
 * No logging of matches, field values, or raw payloads.
 */
export function dashboardInvalidPayloadResponse(
  error?: z.ZodError,
): NextResponse {
  if (error) {
    return jsonError(400, DASHBOARD_INVALID_PAYLOAD_ERROR, {
      issues: formatDashboardZodIssues(error),
    });
  }
  return jsonError(400, DASHBOARD_INVALID_PAYLOAD_ERROR);
}

/**
 * HTTP 409 with body `{ error: "conflict" }` only.
 * No payload contents or block_key values echoed.
 */
export function dashboardBlockKeyConflictResponse(): NextResponse {
  return jsonError(409, DASHBOARD_BLOCK_KEY_CONFLICT_ERROR);
}
