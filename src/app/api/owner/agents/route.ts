import { requireSession } from "@/lib/auth-guard";
import {
  auditOwnerAgentToken,
  createAgentRow,
  listAgentsWithTokens,
} from "@/lib/owner-agent-tokens";
import { clientIp, jsonError, jsonOk } from "@/lib/http";
import { assertSameOrigin } from "@/lib/origin";
import { consumePasskeyAssertion } from "@/lib/passkey-step-up";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireRequest } from "@/lib/require-request";
import { getServiceClient } from "@/lib/supabase/server";
import { verifyAgentTokenStepUpBinding } from "@/lib/agent-token-stepup";
import { createAgentSchema } from "@/lib/validation";

const OWNER_TOKEN_RATE_LIMIT = 20;
const OWNER_TOKEN_RATE_WINDOW_MS = 60_000;

/** GET /api/owner/agents — 姐妹 + 令牌状态（无哈希/明文）。 */
export async function GET() {
  await requireRequest();
  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  try {
    const agents = await listAgentsWithTokens(getServiceClient());
    return jsonOk(
      { agents },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("GET /api/owner/agents failed", err);
    return jsonError(500, "failed to load agents");
  }
}

/** POST /api/owner/agents — 新增姐妹（须重新验 passkey）。 */
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
    `owner-agent:${clientIp(request)}`,
    OWNER_TOKEN_RATE_LIMIT,
    OWNER_TOKEN_RATE_WINDOW_MS,
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

  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const bindingOk = await verifyAgentTokenStepUpBinding(parsed.data.binding, {
    challengeId: parsed.data.challenge_id,
    action: "create_agent",
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

  const created = await createAgentRow(supabase, {
    slug: parsed.data.slug,
    name: parsed.data.name,
    area: parsed.data.area,
    bot_id: parsed.data.bot_id ?? null,
  });
  if (!created.ok) {
    return jsonError(created.status, created.error);
  }

  auditOwnerAgentToken({
    action: "create_agent",
    agent_slug: created.agent.slug,
    credential_id: passkey.credentialId,
  });

  return jsonOk(
    { agent: created.agent },
    {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
