"use client";

import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

export class PasskeyError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PasskeyError";
    this.status = status;
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? res.statusText;
  } catch {
    return res.statusText || "request failed";
  }
}

export async function loginWithPasskey(): Promise<void> {
  const optRes = await fetch("/api/auth/options", { method: "GET" });
  if (optRes.status === 429) {
    throw new PasskeyError("locked", 429);
  }
  if (!optRes.ok) {
    throw new PasskeyError(await readError(optRes), optRes.status);
  }
  const optBody = (await optRes.json()) as {
    challenge_id: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  };

  const assertion = await startAuthentication({
    optionsJSON: optBody.options,
  });

  const verifyRes = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: optBody.challenge_id,
      assertion,
    }),
  });

  if (verifyRes.status === 429) {
    throw new PasskeyError("locked", 429);
  }
  if (!verifyRes.ok) {
    throw new PasskeyError(await readError(verifyRes), verifyRes.status);
  }
}

/**
 * 新设备登记：须带 invite 一次性 token → options → startRegistration → verify。
 */
export async function registerWithPasskey(token: string): Promise<void> {
  const optRes = await fetch("/api/auth/register/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!optRes.ok) {
    throw new PasskeyError(await readError(optRes), optRes.status);
  }
  const optBody = (await optRes.json()) as {
    challenge_id: string;
    options: PublicKeyCredentialCreationOptionsJSON;
  };

  const attestation = await startRegistration({
    optionsJSON: optBody.options,
  });

  const verifyRes = await fetch("/api/auth/register/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id: optBody.challenge_id,
      attestation,
    }),
  });
  if (!verifyRes.ok) {
    throw new PasskeyError(await readError(verifyRes), verifyRes.status);
  }
}

export type DecisionAction = "approve" | "reject" | "reply";

async function requestStepUpOptions(
  body: Record<string, unknown>,
): Promise<{
  challenge_id: string;
  options: PublicKeyCredentialRequestOptionsJSON;
  binding?: string;
}> {
  const optRes = await fetch("/api/auth/options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!optRes.ok) {
    throw new PasskeyError(await readError(optRes), optRes.status);
  }
  return (await optRes.json()) as {
    challenge_id: string;
    options: PublicKeyCredentialRequestOptionsJSON;
    binding?: string;
  };
}

export async function decideWithPasskey(input: {
  itemId: string;
  action: DecisionAction;
  contentHash: string;
  optionKey?: string;
  replyText?: string;
}): Promise<void> {
  const optBody = await requestStepUpOptions({
    purpose: "step_up",
    item_id: input.itemId,
  });

  const assertion = await startAuthentication({
    optionsJSON: optBody.options,
  });

  const body: Record<string, unknown> = {
    action: input.action,
    content_hash: input.contentHash,
    assertion,
    challenge_id: optBody.challenge_id,
  };
  if (input.optionKey) body.option_key = input.optionKey;
  if (input.replyText !== undefined) body.reply_text = input.replyText;

  const decideRes = await fetch(`/api/items/${input.itemId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (decideRes.status === 409) {
    throw new PasskeyError("conflict", 409);
  }
  if (!decideRes.ok) {
    throw new PasskeyError(await readError(decideRes), decideRes.status);
  }
}

async function assertWithBoundStepUp(optionsBody: Record<string, unknown>) {
  const optBody = await requestStepUpOptions(optionsBody);
  if (!optBody.binding) {
    throw new PasskeyError("missing binding", 500);
  }
  const assertion = await startAuthentication({
    optionsJSON: optBody.options,
  });
  return {
    challenge_id: optBody.challenge_id,
    assertion,
    binding: optBody.binding,
  };
}

export async function createAgentWithPasskey(input: {
  slug: string;
  name: string;
  area: string;
  botId?: string | null;
}): Promise<void> {
  const step = await assertWithBoundStepUp({
    purpose: "step_up",
    action: "create_agent",
  });
  const res = await fetch("/api/owner/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slug: input.slug,
      name: input.name,
      area: input.area,
      bot_id: input.botId ?? null,
      assertion: step.assertion,
      challenge_id: step.challenge_id,
      binding: step.binding,
    }),
  });
  if (!res.ok) {
    throw new PasskeyError(await readError(res), res.status);
  }
}

export async function issueAgentTokenWithPasskey(input: {
  agentId: string;
  revokePrevious: boolean;
}): Promise<{
  token: string;
  token_id: string;
  id_suffix: string;
  created_at: string;
  agent_slug: string;
}> {
  const step = await assertWithBoundStepUp({
    purpose: "step_up",
    action: "issue_agent_token",
    agent_id: input.agentId,
  });
  const res = await fetch(`/api/owner/agents/${input.agentId}/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assertion: step.assertion,
      challenge_id: step.challenge_id,
      binding: step.binding,
      revoke_previous: input.revokePrevious,
    }),
  });
  if (!res.ok) {
    throw new PasskeyError(await readError(res), res.status);
  }
  return (await res.json()) as {
    token: string;
    token_id: string;
    id_suffix: string;
    created_at: string;
    agent_slug: string;
  };
}

export async function revokeAgentTokenWithPasskey(input: {
  agentId: string;
  tokenId: string;
}): Promise<void> {
  const step = await assertWithBoundStepUp({
    purpose: "step_up",
    action: "revoke_agent_token",
    agent_id: input.agentId,
    token_id: input.tokenId,
  });
  const res = await fetch(
    `/api/owner/agents/${input.agentId}/tokens/${input.tokenId}/revoke`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assertion: step.assertion,
        challenge_id: step.challenge_id,
        binding: step.binding,
      }),
    },
  );
  if (!res.ok) {
    throw new PasskeyError(await readError(res), res.status);
  }
}

export type MigrateGoalsPlanResponse = {
  action: "plan";
  to_migrate: number;
  already_existing: number;
  scanned: number;
  errors: number;
  csrf_token: string;
  plan_challenge_id: string;
};

export type MigrateGoalsExecuteResponse = {
  action: "execute";
  to_migrate: number;
  already_existing: number;
  scanned: number;
  inserted: number;
  conflict_skip: number;
  errors: number;
  failures: Array<{
    goal_id?: string;
    block_id?: string;
    code: string;
  }>;
  verify: {
    counts_match: boolean;
    goals: number;
    blocks_expected: number;
    missing: number;
    missing_ids: string[];
    decrypt_ok: number;
    decrypt_failed: number;
    decrypt_failed_ids: string[];
    ok: boolean;
  };
};

export async function migrateGoalsPlanWithPasskey(): Promise<MigrateGoalsPlanResponse> {
  const step = await assertWithBoundStepUp({
    purpose: "step_up",
    action: "migrate_goals_plan",
  });
  const res = await fetch("/api/admin/migrate-goals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "plan",
      assertion: step.assertion,
      challenge_id: step.challenge_id,
      binding: step.binding,
    }),
  });
  if (!res.ok) {
    throw new PasskeyError(await readError(res), res.status);
  }
  return (await res.json()) as MigrateGoalsPlanResponse;
}

export async function migrateGoalsExecuteWithPasskey(input: {
  csrfToken: string;
  planChallengeId: string;
  confirm: true;
}): Promise<MigrateGoalsExecuteResponse> {
  const step = await assertWithBoundStepUp({
    purpose: "step_up",
    action: "migrate_goals_execute",
  });
  const res = await fetch("/api/admin/migrate-goals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "execute",
      assertion: step.assertion,
      challenge_id: step.challenge_id,
      binding: step.binding,
      csrf_token: input.csrfToken,
      plan_challenge_id: input.planChallengeId,
      confirm: input.confirm,
    }),
  });
  if (!res.ok) {
    throw new PasskeyError(await readError(res), res.status);
  }
  return (await res.json()) as MigrateGoalsExecuteResponse;
}
