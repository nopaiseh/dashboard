import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  agentTokenIdSuffix,
  generateAgentBearerToken,
} from "@/lib/crypto/agent-token";
import { hashAgentToken } from "@/lib/crypto";
import type {
  AgentTokenListItem,
  AgentWithTokens,
} from "@/lib/owner-agent-tokens-types";

export type { AgentTokenListItem, AgentWithTokens };

export function auditOwnerAgentToken(event: {
  action: "issue" | "revoke" | "create_agent" | "update_token_categories";
  agent_slug: string;
  token_id?: string;
  credential_id: string;
  at?: string;
}): void {
  // Never log allowed_categories contents beyond counts, tokens, or hashes.
  console.info(
    JSON.stringify({
      audit: "owner_agent_token",
      action: event.action,
      agent_slug: event.agent_slug,
      token_id: event.token_id ?? null,
      at: event.at ?? new Date().toISOString(),
      credential_id: event.credential_id,
    }),
  );
}

export async function listAgentsWithTokens(
  supabase: SupabaseClient,
): Promise<AgentWithTokens[]> {
  const { data: agents, error: agentsError } = await supabase
    .from("agents")
    .select("id, slug, name, area, bot_id, created_at")
    .order("created_at", { ascending: true });
  if (agentsError) {
    throw new Error("failed to load agents");
  }

  const { data: tokens, error: tokensError } = await supabase
    .from("agent_tokens")
    .select("id, agent_id, created_at, revoked_at, allowed_categories")
    .order("created_at", { ascending: false });
  if (tokensError) {
    throw new Error("failed to load agent tokens");
  }

  const byAgent = new Map<string, AgentTokenListItem[]>();
  for (const row of tokens ?? []) {
    const list = byAgent.get(row.agent_id) ?? [];
    const cats = Array.isArray(row.allowed_categories)
      ? (row.allowed_categories as string[])
      : [];
    list.push({
      id: row.id,
      id_suffix: agentTokenIdSuffix(row.id),
      created_at: row.created_at,
      revoked_at: row.revoked_at,
      allowed_categories: cats,
    });
    byAgent.set(row.agent_id, list);
  }

  return ((agents ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    area: string;
    bot_id: string | null;
    created_at: string;
  }>).map((agent) => ({
    ...agent,
    tokens: byAgent.get(agent.id) ?? [],
  }));
}

export async function createAgentRow(
  supabase: SupabaseClient,
  input: {
    slug: string;
    name: string;
    area: string;
    bot_id: string | null;
  },
): Promise<
  | { ok: true; agent: AgentWithTokens }
  | { ok: false; status: number; error: string }
> {
  const { data, error } = await supabase
    .from("agents")
    .insert({
      slug: input.slug,
      name: input.name,
      area: input.area,
      bot_id: input.bot_id,
    })
    .select("id, slug, name, area, bot_id, created_at")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, status: 409, error: "slug already exists" };
    }
    return { ok: false, status: 500, error: "failed to create agent" };
  }

  return {
    ok: true,
    agent: {
      id: data.id,
      slug: data.slug,
      name: data.name,
      area: data.area,
      bot_id: data.bot_id,
      created_at: data.created_at,
      tokens: [],
    },
  };
}

export async function issueAgentToken(
  supabase: SupabaseClient,
  input: {
    agentId: string;
    revokePrevious: boolean;
    /** Required non-empty normalized lowercase categories. Never defaults to all. */
    allowedCategories: string[];
  },
): Promise<
  | {
      ok: true;
      token: string;
      tokenId: string;
      createdAt: string;
      agentSlug: string;
      allowedCategories: string[];
    }
  | { ok: false; status: number; error: string }
> {
  if (input.allowedCategories.length === 0) {
    return { ok: false, status: 400, error: "allowed_categories required" };
  }

  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, slug")
    .eq("id", input.agentId)
    .maybeSingle();
  if (agentError) {
    return { ok: false, status: 500, error: "failed to load agent" };
  }
  if (!agent) {
    return { ok: false, status: 404, error: "agent not found" };
  }

  if (input.revokePrevious) {
    const now = new Date().toISOString();
    const { error: revokeError } = await supabase
      .from("agent_tokens")
      .update({ revoked_at: now })
      .eq("agent_id", input.agentId)
      .is("revoked_at", null);
    if (revokeError) {
      return { ok: false, status: 500, error: "failed to revoke previous tokens" };
    }
  }

  const raw = generateAgentBearerToken();
  const tokenHash = hashAgentToken(raw);
  const { data: row, error: insertError } = await supabase
    .from("agent_tokens")
    .insert({
      agent_id: input.agentId,
      token_hash: tokenHash,
      allowed_categories: input.allowedCategories,
    })
    .select("id, created_at, allowed_categories")
    .single();

  if (insertError || !row) {
    return { ok: false, status: 500, error: "failed to issue token" };
  }

  return {
    ok: true,
    token: raw,
    tokenId: row.id,
    createdAt: row.created_at,
    agentSlug: agent.slug,
    allowedCategories: Array.isArray(row.allowed_categories)
      ? (row.allowed_categories as string[])
      : input.allowedCategories,
  };
}

export async function updateAgentTokenCategories(
  supabase: SupabaseClient,
  input: {
    agentId: string;
    tokenId: string;
    allowedCategories: string[];
  },
): Promise<
  | {
      ok: true;
      tokenId: string;
      agentSlug: string;
      allowedCategories: string[];
      updatedAt: string;
    }
  | { ok: false; status: number; error: string }
> {
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, slug")
    .eq("id", input.agentId)
    .maybeSingle();
  if (agentError) {
    return { ok: false, status: 500, error: "failed to load agent" };
  }
  if (!agent) {
    return { ok: false, status: 404, error: "agent not found" };
  }

  const { data: existing, error: loadError } = await supabase
    .from("agent_tokens")
    .select("id, agent_id, revoked_at")
    .eq("id", input.tokenId)
    .maybeSingle();
  if (loadError) {
    return { ok: false, status: 500, error: "failed to load token" };
  }
  if (!existing || existing.agent_id !== input.agentId) {
    return { ok: false, status: 404, error: "token not found" };
  }
  if (existing.revoked_at) {
    return { ok: false, status: 409, error: "token already revoked" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("agent_tokens")
    .update({ allowed_categories: input.allowedCategories })
    .eq("id", input.tokenId)
    .eq("agent_id", input.agentId)
    .is("revoked_at", null)
    .select("id, allowed_categories")
    .maybeSingle();

  if (updateError) {
    return { ok: false, status: 500, error: "failed to update token categories" };
  }
  if (!updated) {
    return { ok: false, status: 409, error: "token already revoked" };
  }

  return {
    ok: true,
    tokenId: updated.id,
    agentSlug: agent.slug,
    allowedCategories: Array.isArray(updated.allowed_categories)
      ? (updated.allowed_categories as string[])
      : input.allowedCategories,
    updatedAt: new Date().toISOString(),
  };
}

export async function revokeAgentToken(
  supabase: SupabaseClient,
  input: { agentId: string; tokenId: string },
): Promise<
  | { ok: true; tokenId: string; agentSlug: string; revokedAt: string }
  | { ok: false; status: number; error: string }
> {
  const { data: agent, error: agentError } = await supabase
    .from("agents")
    .select("id, slug")
    .eq("id", input.agentId)
    .maybeSingle();
  if (agentError) {
    return { ok: false, status: 500, error: "failed to load agent" };
  }
  if (!agent) {
    return { ok: false, status: 404, error: "agent not found" };
  }

  const { data: existing, error: loadError } = await supabase
    .from("agent_tokens")
    .select("id, agent_id, revoked_at")
    .eq("id", input.tokenId)
    .maybeSingle();
  if (loadError) {
    return { ok: false, status: 500, error: "failed to load token" };
  }
  if (!existing || existing.agent_id !== input.agentId) {
    return { ok: false, status: 404, error: "token not found" };
  }
  if (existing.revoked_at) {
    return { ok: false, status: 409, error: "token already revoked" };
  }

  const revokedAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("agent_tokens")
    .update({ revoked_at: revokedAt })
    .eq("id", input.tokenId)
    .is("revoked_at", null)
    .select("id, revoked_at")
    .maybeSingle();

  if (updateError) {
    return { ok: false, status: 500, error: "failed to revoke token" };
  }
  if (!updated) {
    return { ok: false, status: 409, error: "token already revoked" };
  }

  return {
    ok: true,
    tokenId: updated.id,
    agentSlug: agent.slug,
    revokedAt: updated.revoked_at ?? revokedAt,
  };
}
