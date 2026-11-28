import { verifyAgentTokenStepUpBinding } from "@/lib/agent-token-stepup";
import { requireSession } from "@/lib/auth-guard";
import { normalizeDashboardCategory } from "@/lib/dashboard/category";
import {
  addDashboardWriter,
  listDashboardWriters,
  removeDashboardWriter,
} from "@/lib/dashboard/writers";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { consumePasskeyAssertion } from "@/lib/passkey-step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import {
  addDashboardWriterSchema,
  removeDashboardWriterSchema,
} from "@/lib/validation";

const OWNER_WRITER_RATE_LIMIT = 20;
const OWNER_WRITER_RATE_WINDOW_MS = 60_000;

/**
 * GET /api/owner/dashboard/writers?category=
 * List writer assignments (optionally filtered). Session required (no step-up).
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

  const url = new URL(request.url);
  const rawCategory = url.searchParams.get("category");
  const category =
    rawCategory !== null && rawCategory.length > 0
      ? normalizeDashboardCategory(rawCategory)
      : undefined;

  const supabase = getServiceClient();
  try {
    const writers = await listDashboardWriters(
      supabase,
      category ? { category } : undefined,
    );
    return jsonOk(
      { writers },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return jsonError(500, "failed to load writers");
  }
}

/**
 * POST /api/owner/dashboard/writers
 * Add a writer for a category. Session + passkey step-up.
 */
export async function POST(request: Request) {
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

  const parsed = addDashboardWriterSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const bindingOk = await verifyAgentTokenStepUpBinding(parsed.data.binding, {
    challengeId: parsed.data.challenge_id,
    action: "add_dashboard_writer",
    agentId: parsed.data.agent_id,
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

  const result = await addDashboardWriter(supabase, {
    category: parsed.data.category,
    agentId: parsed.data.agent_id,
  });
  if (!result.ok) {
    return jsonError(result.status, result.error);
  }

  console.info(
    JSON.stringify({
      audit: "owner_dashboard_writer",
      action: "add_dashboard_writer",
      category: result.writer.category,
      agent_id: result.writer.agent_id,
      credential_id: passkey.credentialId,
      at: result.writer.created_at,
    }),
  );

  return jsonOk(
    { writer: result.writer },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * DELETE /api/owner/dashboard/writers
 * Remove a writer for a category. Session + passkey step-up.
 */
export async function DELETE(request: Request) {
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

  const parsed = removeDashboardWriterSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const bindingOk = await verifyAgentTokenStepUpBinding(parsed.data.binding, {
    challengeId: parsed.data.challenge_id,
    action: "remove_dashboard_writer",
    agentId: parsed.data.agent_id,
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

  const result = await removeDashboardWriter(supabase, {
    category: parsed.data.category,
    agentId: parsed.data.agent_id,
  });
  if (!result.ok) {
    return jsonError(result.status, result.error);
  }

  console.info(
    JSON.stringify({
      audit: "owner_dashboard_writer",
      action: "remove_dashboard_writer",
      category: result.category,
      agent_id: result.agentId,
      credential_id: passkey.credentialId,
      at: new Date().toISOString(),
    }),
  );

  return jsonOk(
    { removed: { category: result.category, agent_id: result.agentId } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
