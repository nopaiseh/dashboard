import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { claimChallenge } from "@/lib/challenges";
import { verifyLoginAssertion, type StoredCredential } from "@/lib/webauthn";

/**
 * 抢占挑战并校验通行密钥断言（决定 / 发令牌 / 吊销共用）。
 * purpose：决定用 step_up；所有者令牌操作（无迁移）用 login + 外层 binding。
 */
export async function consumePasskeyAssertion(input: {
  supabase: SupabaseClient;
  challengeId: string;
  purpose: "login" | "step_up" | "register";
  itemId?: string | null;
  assertion: unknown;
}): Promise<
  | { ok: true; credentialId: string }
  | { ok: false; status: number; error: string }
> {
  const challengeRow = await claimChallenge(
    input.supabase,
    input.challengeId,
    input.purpose,
    input.itemId,
  );
  if (!challengeRow) {
    return { ok: false, status: 400, error: "invalid challenge" };
  }
  if (
    input.purpose === "step_up" &&
    input.itemId &&
    challengeRow.item_id !== input.itemId
  ) {
    return { ok: false, status: 400, error: "challenge item mismatch" };
  }

  const assertion = input.assertion as { id?: string };
  const credentialId = assertion?.id;
  if (!credentialId) {
    return { ok: false, status: 400, error: "assertion missing credential id" };
  }

  const { data: credential } = await input.supabase
    .from("webauthn_credentials")
    .select("*")
    .eq("credential_id", credentialId)
    .maybeSingle();

  if (!credential) {
    return { ok: false, status: 401, error: "unknown credential" };
  }

  let verification;
  try {
    verification = await verifyLoginAssertion(
      input.assertion,
      challengeRow.challenge,
      credential as StoredCredential,
    );
  } catch {
    return { ok: false, status: 401, error: "passkey verification failed" };
  }

  if (!verification.verified) {
    return { ok: false, status: 401, error: "passkey verification failed" };
  }

  await input.supabase
    .from("webauthn_credentials")
    .update({ counter: verification.authenticationInfo.newCounter })
    .eq("credential_id", credentialId);

  return { ok: true, credentialId };
}
