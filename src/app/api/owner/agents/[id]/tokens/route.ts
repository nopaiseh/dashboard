import { verifyAgentTokenStepUpBinding } from "@/lib/agent-token-stepup";
import { requireSession } from "@/lib/auth-guard";
import {
  auditOwnerAgentToken,
  issueAgentToken,
} from "@/lib/owner-agent-tokens";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { consumePasskeyAssertion } from "@/lib/passkey-step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import { issueAgentTokenSchema } from "@/lib/validation";
import { agentTokenIdSuffix } from "@/lib/crypto/agent-token";

type RouteContext = { params: Promise<{ id: string }> };

const OWNER_TOKEN_RATE_LIMIT = 20;
const OWNER_TOKEN_RATE_WINDOW_MS = 60_000;

/**
 * POST /api/owner/agents/:id/tokens
 * 签发姐妹 Bearer 令牌；明文只在本响应返回一次；须重新验 passkey。
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

  const { id: agentId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = issueAgentTokenSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const bindingOk = await verifyAgentTokenStepUpBinding(parsed.data.binding, {
    challengeId: parsed.data.challenge_id,
    action: "issue_agent_token",
    agentId,
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

  const issued = await issueAgentToken(supabase, {
    agentId,
    revokePrevious: parsed.data.revoke_previous,
  });
  if (!issued.ok) {
    return jsonError(issued.status, issued.error);
  }

  auditOwnerAgentToken({
    action: "issue",
    agent_slug: issued.agentSlug,
    token_id: issued.tokenId,
    credential_id: passkey.credentialId,
    at: issued.createdAt,
  });

  return jsonOk(
    {
      token: issued.token,
      token_id: issued.tokenId,
      id_suffix: agentTokenIdSuffix(issued.tokenId),
      created_at: issued.createdAt,
      agent_slug: issued.agentSlug,
    },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
