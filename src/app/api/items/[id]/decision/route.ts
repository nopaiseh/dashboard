import { requireSession } from "@/lib/auth-guard";
import { claimChallenge } from "@/lib/challenges";
import { jsonError, jsonOk } from "@/lib/http";
import {
  assertDecisionAllowed,
  decisionToStatus,
} from "@/lib/items-logic";
import { assertSameOrigin } from "@/lib/origin";
import { getServiceClient } from "@/lib/supabase/server";
import type { ItemRow } from "@/lib/types";
import { decisionSchema } from "@/lib/validation";
import { verifyLoginAssertion, type StoredCredential } from "@/lib/webauthn";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const origin = assertSameOrigin(request);
  if (!origin.ok) {
    return jsonError(403, origin.error);
  }

  const session = await requireSession();
  if (!session.ok) {
    return jsonError(session.status, session.error);
  }

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "invalid json");
  }

  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(400, "invalid body", { details: parsed.error.flatten() });
  }

  const supabase = getServiceClient();

  const challengeRow = await claimChallenge(
    supabase,
    parsed.data.challenge_id,
    "step_up",
    id,
  );
  if (!challengeRow) {
    return jsonError(400, "invalid challenge");
  }
  if (challengeRow.item_id !== id) {
    return jsonError(400, "challenge item mismatch");
  }

  const assertion = parsed.data.assertion as { id?: string };
  const credentialId = assertion?.id;
  if (!credentialId) {
    return jsonError(400, "assertion missing credential id");
  }

  const { data: credential } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (!credential) {
    return jsonError(401, "unknown credential");
  }

  let verification;
  try {
    verification = await verifyLoginAssertion(
      parsed.data.assertion,
      challengeRow.challenge,
      credential as StoredCredential,
    );
  } catch {
    return jsonError(401, "passkey verification failed");
  }

  if (!verification.verified) {
    return jsonError(401, "passkey verification failed");
  }

  const verifiedAt = new Date().toISOString();

  await supabase
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq("credential_id", credentialId);

  const { data: item, error: itemError } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (itemError || !item) {
    return jsonError(404, "item not found");
  }

  const typed = item as ItemRow;
  const allowed = assertDecisionAllowed(
    typed.kind,
    parsed.data.action,
    typed.status,
    parsed.data.option_key,
    typed.options ?? [],
    parsed.data.content_hash,
    typed.content_hash,
  );
  if (!allowed.ok) {
    return jsonError(409, allowed.error);
  }

  const nextStatus = decisionToStatus(parsed.data.action);
  const { data, error } = await supabase.rpc("apply_item_decision", {
    p_item_id: id,
    p_action: parsed.data.action,
    p_expected_content_hash: parsed.data.content_hash,
    p_option_key: parsed.data.option_key ?? null,
    p_reply_text: parsed.data.reply_text ?? null,
    p_credential_id: credentialId,
    p_verified_at: verifiedAt,
    p_next_status: nextStatus,
  });

  if (error || !data) {
    console.error("apply_item_decision failed", error);
    return jsonError(409, "decision failed");
  }

  return jsonOk(data);
}
