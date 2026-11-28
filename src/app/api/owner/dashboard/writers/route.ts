import { verifyAgentTokenStepUpBinding } from "@/lib/agent-token-stepup";
import { requireSession } from "@/lib/auth-guard";
import {
  listDashboardWriters,
  upsertDashboardWriter,
} from "@/lib/dashboard/writers";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { consumePasskeyAssertion } from "@/lib/passkey-step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import { setDashboardWriterSchema } from "@/lib/validation";

const OWNER_WRITER_RATE_LIMIT = 20;
const OWNER_WRITER_RATE_WINDOW_MS = 60_000;

/**
 * GET /api/owner/dashboard/writers
 * List category → writer assignments. Session required (no step-up).
 */
export async function GET(request: Request) {
  await requireRequest();
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }

  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  const supabase = getServiceClient();
  try {
    const writers = await listDashboardWriters(supabase);
    return jsonOk(
      { writers },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError(500, "failed to load writers");
  }
}

/**
 * PUT /api/owner/dashboard/writers
 * Create or change the designated writer for a category.
 * Requires owner session + passkey step-up (same tier as token issue).
 */
export async function PUT(request: Request) {
  await requireRequest();
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }

  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  const rate = checkRateLimit(
    `owner-dashboard-writer:${clientIp(request)}`,
    OWNER_WRITER_RATE_LIMIT,
    OWNER_WRITER_RATE_WINDOW_MS,
  );
  if (!rate.allowed) {
    return jsonError(429, "rate limit exceeded", {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = setDashboardWriterSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const bindingOk = await verifyAgentTokenStepUpBinding(parsed.data.binding, {
    challengeId: parsed.data.challenge_id,
    action: "set_dashboard_writer",
    agentId: parsed.data.writer_agent_id,
    category: parsed.data.category,
  });
  if (!bindingOk) {
    return jsonError(400, "invalid binding");
  }

  const supabase = getServiceClient();
  const passkey = await consumePasskeyAssertion({
    supabase,
    challengeId: parsed.data.challenge_id,
    purpose: "login",
    assertion: parsed.data.assertion,
  });
  if (!passkey.ok) {
    return jsonError(passkey.status, passkey.error);
  }

  const result = await upsertDashboardWriter(supabase, {
    category: parsed.data.category,
    writerAgentId: parsed.data.writer_agent_id,
  });
  if (!result.ok) {
    return jsonError(result.status, result.error);
  }

  console.info(
    JSON.stringify({
      audit: "owner_dashboard_writer",
      action: "set_dashboard_writer",
      category: result.writer.category,
      writer_agent_id: result.writer.writer_agent_id,
      credential_id: passkey.credentialId,
      at: result.writer.updated_at,
    }),
  );

  return jsonOk(
    { writer: result.writer },
    { headers: { "Cache-Control": "no-store" } },
  );
}
