import { resolveAgentFromRequest } from "@/lib/agent-service";
import { jsonError, jsonOk } from "@/lib/http";
import {
  isPgConflict,
  isPgForbidden,
  isPgNotFound,
} from "@/lib/pg-errors";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };

const idSchema = z.string().uuid();

/**
 * 姐妹回写「结果已读」。
 * 鉴权：Bearer agent token（与其它 /api/agent/* 相同）。
 * 成功后 items.result_read_at 有值 → 阁主侧显示「已读取」。
 */
export async function POST(request: Request, context: RouteContext) {
  await requireRequest();
  const { id } = await context.params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) {
    return jsonError(404, "item not found");
  }

  const supabase = getServiceClient();
  const auth = await resolveAgentFromRequest(
    supabase,
    request.headers.get("authorization"),
  );
  if (!auth.ok) {
    return jsonError(auth.status, auth.error, {
      retryAfterSeconds: auth.retryAfterSeconds,
    });
  }

  const { data, error } = await supabase.rpc("mark_item_result_read", {
    p_item_id: parsed.data,
    p_agent_id: auth.agent.agentId,
  });

  if (error) {
    if (isPgConflict(error)) {
      return jsonError(409, "conflict");
    }
    if (isPgForbidden(error)) {
      return jsonError(403, "forbidden");
    }
    if (isPgNotFound(error)) {
      return jsonError(404, "item not found");
    }
    console.error("mark_item_result_read failed", error);
    return jsonError(500, "failed to mark result read");
  }

  if (!data) {
    return jsonError(404, "item not found");
  }

  return jsonOk({ item: data });
}
