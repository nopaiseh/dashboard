import { verifyAgentTokenStepUpBinding } from "@/lib/agent-token-stepup";
import { requireSession } from "@/lib/auth-guard";
import {
  auditOwnerAgentToken,
  updateAgentTokenCategories,
} from "@/lib/owner-agent-tokens";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { consumePasskeyAssertion } from "@/lib/passkey-step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import { updateAgentTokenCategoriesSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string; tokenId: string }> };

const OWNER_TOKEN_RATE_LIMIT = 20;
const OWNER_TOKEN_RATE_WINDOW_MS = 60_000;

/**
 * PATCH /api/owner/agents/:id/tokens/:tokenId/categories
 * Update allowed_categories for an active token; requires passkey step-up.
 */
export async function PATCH(request: Request, context: RouteContext) {
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
    `owner-agent:${clientIp(request)}`,
    OWNER_TOKEN_RATE_LIMIT,
    OWNER_TOKEN_RATE_WINDOW_MS,
  );
  if (!rate.allowed) {
    return jsonError(429, "rate limit exceeded", {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const { id: agentId, tokenId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = updateAgentTokenCategoriesSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const bindingOk = await verifyAgentTokenStepUpBinding(parsed.data.binding, {
    challengeId: parsed.data.challenge_id,
    action: "update_agent_token_categories",
    agentId,
    tokenId,
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

  const updated = await updateAgentTokenCategories(supabase, {
    agentId,
    tokenId,
    allowedCategories: parsed.data.allowed_categories,
  });
  if (!updated.ok) {
    return jsonError(updated.status, updated.error);
  }

  auditOwnerAgentToken({
    action: "update_token_categories",
    agent_slug: updated.agentSlug,
    token_id: updated.tokenId,
    credential_id: passkey.credentialId,
    at: updated.updatedAt,
  });

  return jsonOk(
    {
      token_id: updated.tokenId,
      agent_slug: updated.agentSlug,
      allowed_categories: updated.allowedCategories,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
