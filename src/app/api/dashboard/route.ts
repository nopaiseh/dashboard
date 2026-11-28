import { requireSession } from "@/lib/auth-guard";
import { loadDashboard } from "@/lib/read/data";
import { jsonError, jsonOkNoStore } from "@/lib/http";
import { requireRequest } from "@/lib/require-request";
import { DataReadError, SessionRequiredError } from "@/lib/read/errors";

/**
 * Owner read: decrypted dashboard sections/blocks.
 * `headline` is "" when missing so the frontend can fall back to default copy.
 * Cache-Control: no-store — response contains decrypted payloads.
 */
export async function GET() {
  await requireRequest();
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  try {
    const dashboard = await loadDashboard();
    return jsonOkNoStore(dashboard);
  } catch (err) {
    if (err instanceof SessionRequiredError) {
      return jsonError(401, "unauthorized");
    }
    if (err instanceof DataReadError) {
      return jsonError(500, "failed to load dashboard");
    }
    console.error("GET /api/dashboard failed");
    return jsonError(500, "failed to load dashboard");
  }
}
