import { z } from "zod";
import { requireSession } from "@/lib/auth-guard";
import { jsonError, jsonOk } from "@/lib/http";
import { decisionToStatus } from "@/lib/items-logic";
import { getServiceClient } from "@/lib/supabase/server";
import { verifyLoginAssertion, type StoredCredential } from "@/lib/webauthn";
import type { ItemRow } from "@/lib/types";

const decisionSchema = z.object({
  action: z.enum(["approve", "reject", "reply"]),
  option_key: z.string().optional(),
  reply_text: z.string().optional(),
  assertion: z.unknown(),
  challenge_id: z.string().uuid(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
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

  const { data: challengeRow, error: challengeError } = await supabase
    .from("webauthn_challenges")
    .select("*")
    .eq("id", parsed.data.challenge_id)
    .eq("purpose", "step_up")
    .maybeSingle();

  if (challengeError || !challengeRow) {
    return jsonError(400, "invalid challenge");
  }
  if (new Date(challengeRow.expires_at).getTime() < Date.now()) {
    return jsonError(400, "challenge expired");
  }
  if (challengeRow.item_id && challengeRow.item_id !== id) {
    return jsonError(400, "challenge item mismatch");
  }

  const assertion = parsed.data.assertion as { id?: string };
  const credentialId = assertion?.id;
  if (!credentialId) {
    return jsonError(400, "assertion missing credential id");
  }

  const { data: credential, error: credError } = await supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (credError || !credential) {
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

  await supabase
    .from("webauthn_challenges")
    .delete()
    .eq("id", parsed.data.challenge_id);

  const { data: item, error: itemError } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (itemError || !item) {
    return jsonError(404, "item not found");
  }

  const typed = item as ItemRow;
  const nextStatus = decisionToStatus(parsed.data.action);

  const { data: updated, error: updateError } = await supabase
    .from("items")
    .update({
      status: nextStatus,
      last_activity_at: verifiedAt,
      updated_at: verifiedAt,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (updateError || !updated) {
    return jsonError(500, "failed to update item");
  }

  const { data: event, error: eventError } = await supabase
    .from("item_events")
    .insert({
      item_id: id,
      actor_type: "user",
      action: parsed.data.action,
      option_key: parsed.data.option_key ?? null,
      reply_text: parsed.data.reply_text ?? null,
      credential_id: credentialId,
      verified_at: verifiedAt,
      content_hash: typed.content_hash,
    })
    .select("*")
    .single();

  if (eventError || !event) {
    return jsonError(500, "failed to write event");
  }

  return jsonOk({ item: updated, event });
}
