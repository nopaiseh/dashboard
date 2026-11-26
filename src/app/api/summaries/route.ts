import { requireSession } from "@/lib/auth-guard";
import { jsonError, jsonOk } from "@/lib/http";
import { getServiceClient } from "@/lib/supabase/server";

export async function GET() {
  await requireRequest();
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("daily_summaries")
    .select("*")
    .order("date", { ascending: false })
    .limit(30);

  if (error) {
    return jsonError(500, "failed to load summaries");
  }

  return jsonOk({ summaries: data ?? [] });
}
import { requireRequest } from "@/lib/require-request";
