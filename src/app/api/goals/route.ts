import { requireSession } from "@/lib/auth-guard";
import { jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import { requireRequest } from "@/lib/require-request";

/**
 * Legacy owner read of `goals` (table is DB read-only this release).
 * Prefer `GET /api/dashboard` for encrypted progress blocks after migration.
 * No write methods — goals writes are revoked at the database layer.
 */
export async function GET() {
  await requireRequest();
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    return jsonError(500, "failed to load goals");
  }

  return jsonOk({ goals: data ?? [] });
}
