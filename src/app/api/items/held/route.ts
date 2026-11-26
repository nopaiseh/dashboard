import { requireSession } from "@/lib/auth-guard";
import { jsonError, jsonOk } from "@/lib/http";
import {
  isDataReadError,
  isSessionRequiredError,
  loadHeldItems,
} from "@/lib/read";
import { requireRequest } from "@/lib/require-request";

/** 搁置列表：open 且 7 天无活动（与 held.ts / stale_items 一致）。 */
export async function GET() {
  await requireRequest();
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  try {
    const items = await loadHeldItems();
    return jsonOk({ items });
  } catch (err) {
    if (isSessionRequiredError(err)) {
      return jsonError(401, "unauthorized");
    }
    if (isDataReadError(err)) {
      console.error("GET /api/items/held failed", err);
      return jsonError(500, "failed to load held items");
    }
    throw err;
  }
}
