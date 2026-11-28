import { verifyAgentTokenStepUpBinding } from "@/lib/agent-token-stepup";
import { requireSession } from "@/lib/auth-guard";
import {
  auditOwnerAgentToken,
  revokeAgentToken,
} from "@/lib/owner-agent-tokens";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { consumePasskeyAssertion } from "@/lib/passkey-step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import { revokeAgentTokenSchema } from "@/lib/validation";

type RouteContext = { params: Promise<{ id: string; tokenId: string }> };

const OWNER_TOKEN_RATE_LIMIT = 20;
const OWNER_TOKEN_RATE_WINDOW_MS = 60_000;

/**
 * POST /api/owner/agents/:id/tokens/:tokenId/revoke
 * 设 revoked_at，不删行；须重新验 passkey。
 */
export async function POST(request: Request, context: RouteContext) {
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

  const parsed = revokeAgentTokenSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const bindingOk = await verifyAgentTokenStepUpBinding(parsed.data.binding, {
    challengeId: parsed.data.challenge_id,
    action: "revoke_agent_token",
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

  const revoked = await revokeAgentToken(supabase, { agentId, tokenId });
  if (!revoked.ok) {
    return jsonError(revoked.status, revoked.error);
  }

  auditOwnerAgentToken({
    action: "revoke",
    agent_slug: revoked.agentSlug,
    token_id: revoked.tokenId,
    credential_id: passkey.credentialId,
    at: revoked.revokedAt,
  });

  return jsonOk(
    {
      token_id: revoked.tokenId,
      revoked_at: revoked.revokedAt,
      agent_slug: revoked.agentSlug,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
