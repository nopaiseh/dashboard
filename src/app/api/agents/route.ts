import { requireSession } from "@/lib/auth-guard";
import { jsonError, jsonOk } from "@/lib/http";
import {
  isDataReadError,
  isSessionRequiredError,
  loadAgents,
} from "@/lib/read";
import { requireRequest } from "@/lib/require-request";

export async function GET() {
  await requireRequest();
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  try {
    const agents = await loadAgents();
    return jsonOk({ agents });
  } catch (err) {
    if (isSessionRequiredError(err)) {
      return jsonError(401, "unauthorized");
    }
    if (isDataReadError(err)) {
      console.error("GET /api/agents failed", err);
      return jsonError(500, "failed to load agents");
    }
    throw err;
  }
}
