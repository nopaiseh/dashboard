import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { deriveMigrateGoalsStepUpKey } from "@/lib/crypto/hkdf";

/**
 * Short-lived proof that the owner completed a passkey step-up for migrate-goals
 * (dry-run). Required to keep the page unlocked; execute needs a fresh assertion.
 */
export const MIGRATE_GOALS_STEPUP_COOKIE = "xjg_migrate_goals_stepup";
export const MIGRATE_GOALS_STEPUP_AUD = "xjg-migrate-goals-stepup";
export const MIGRATE_GOALS_STEPUP_TYP = "migrate_goals_stepup";
export const MIGRATE_GOALS_STEPUP_TTL_MS = 5 * 60 * 1000;

function stepUpKey(): Uint8Array {
  return deriveMigrateGoalsStepUpKey();
}

export async function createMigrateGoalsStepUpToken(
  input: { credentialId: string; planChallengeId: string },
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({
    typ: MIGRATE_GOALS_STEPUP_TYP,
    purpose: "migrate_goals_stepup",
    credential_id: input.credentialId,
    plan_challenge_id: input.planChallengeId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setAudience(MIGRATE_GOALS_STEPUP_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + Math.floor(MIGRATE_GOALS_STEPUP_TTL_MS / 1000))
    .sign(stepUpKey());
}

export async function verifyMigrateGoalsStepUpToken(
  token: string,
  now: Date = new Date(),
): Promise<{ ok: true; planChallengeId: string } | { ok: false }> {
  try {
    const { payload } = await jwtVerify(token, stepUpKey(), {
      algorithms: ["HS256"],
      audience: MIGRATE_GOALS_STEPUP_AUD,
      currentDate: now,
    });
    if ((payload as { typ?: string }).typ === "session") {
      return { ok: false };
    }
    if (
      payload.sub !== "owner" ||
      (payload as { typ?: string }).typ !== MIGRATE_GOALS_STEPUP_TYP ||
      (payload as { purpose?: string }).purpose !== "migrate_goals_stepup"
    ) {
      return { ok: false };
    }
    const planChallengeId = (payload as { plan_challenge_id?: string })
      .plan_challenge_id;
    if (!planChallengeId) return { ok: false };
    return { ok: true, planChallengeId };
  } catch {
    return { ok: false };
  }
}

export function migrateGoalsStepUpCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict" as const,
    // Cover page + /api/admin/migrate-goals
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
