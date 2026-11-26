import { requireSession } from "@/lib/auth-guard";
import { jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";
import { requireRequest } from "@/lib/require-request";

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
