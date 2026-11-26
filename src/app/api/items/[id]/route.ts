import { requireSession } from "@/lib/auth-guard";
import { jsonError, jsonOk } from "@/lib/http";
import {
  isDataReadError,
  isSessionRequiredError,
  loadItemDetail,
} from "@/lib/read";
import { requireRequest } from "@/lib/require-request";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z.string().uuid();

export async function GET(_request: Request, context: RouteContext) {
  await requireRequest();
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return jsonError(404, "item not found");
  }

  try {
    const detail = await loadItemDetail(parsed.data);
    if (!detail) {
      return jsonError(404, "item not found");
    }
    return jsonOk({
      item: detail.item,
      events: detail.events,
    });
  } catch (err) {
    if (isSessionRequiredError(err)) {
      return jsonError(401, "unauthorized");
    }
    if (isDataReadError(err)) {
      console.error("GET /api/items/:id failed", err);
      return jsonError(500, "failed to load item");
    }
    throw err;
  }
}
