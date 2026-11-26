import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChallengeRow {
  id: string;
  challenge: string;
  purpose: string;
  item_id: string | null;
  authorized: boolean;
  expires_at: string;
}

/** 先 delete … returning 抢占挑战，避免重放。 */
export async function claimChallenge(
  supabase: SupabaseClient,
  id: string,
  purpose: string,
  itemId?: string | null,
): Promise<ChallengeRow | null> {
  const { data, error } = await supabase.rpc("claim_webauthn_challenge", {
    p_id: id,
    p_purpose: purpose,
    p_item_id: itemId ?? null,
  });
  if (error || !data) {
    return null;
  }
  return data as ChallengeRow;
}
