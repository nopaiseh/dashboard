import "server-only";

import { SignJWT, jwtVerify } from "jose";
import { hkdfSync } from "node:crypto";
import { getSessionSecret } from "@/lib/env";

/** Anti-forgery token issued after a successful dry-run; required on execute. */
export const MIGRATE_GOALS_CSRF_AUD = "xjg-migrate-goals-csrf";
export const MIGRATE_GOALS_CSRF_TYP = "migrate_goals_csrf";
export const MIGRATE_GOALS_CSRF_TTL_MS = 5 * 60 * 1000;
const HKDF_INFO = "xjg-migrate-goals-csrf-v1";
const HKDF_SALT = "xjg-hkdf-salt-v1";

function csrfKey(): Uint8Array {
  const ikm = Buffer.from(getSessionSecret(), "utf8");
  const salt = Buffer.from(HKDF_SALT, "utf8");
  const info = Buffer.from(HKDF_INFO, "utf8");
  return new Uint8Array(hkdfSync("sha256", ikm, salt, info, 32));
}

export async function createMigrateGoalsCsrfToken(
  input: { planChallengeId: string },
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({
    typ: MIGRATE_GOALS_CSRF_TYP,
    purpose: "migrate_goals_csrf",
    plan_challenge_id: input.planChallengeId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("owner")
    .setAudience(MIGRATE_GOALS_CSRF_AUD)
    .setIssuedAt(iat)
    .setExpirationTime(iat + Math.floor(MIGRATE_GOALS_CSRF_TTL_MS / 1000))
    .sign(csrfKey());
}

export async function verifyMigrateGoalsCsrfToken(
  token: string,
  expected: { planChallengeId: string },
  now: Date = new Date(),
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, csrfKey(), {
      algorithms: ["HS256"],
      audience: MIGRATE_GOALS_CSRF_AUD,
      currentDate: now,
    });
    if ((payload as { typ?: string }).typ === "session") return false;
    if (payload.sub !== "owner") return false;
    if ((payload as { typ?: string }).typ !== MIGRATE_GOALS_CSRF_TYP) {
      return false;
    }
    if (
      (payload as { purpose?: string }).purpose !== "migrate_goals_csrf"
    ) {
      return false;
    }
    if (
      (payload as { plan_challenge_id?: string }).plan_challenge_id !==
      expected.planChallengeId
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
