import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearedAttemptState,
  evaluateLoginLockout,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  type LoginAttemptState,
} from "@/lib/login-lockout";

const LOCKED_ERROR = "locked: too many failed login attempts";

type LoadResult =
  | { ok: true; attempt: LoginAttemptState | null }
  | { ok: false };

async function loadAttempt(
  supabase: SupabaseClient,
  scope: "ip" | "credential" | "global",
  scopeKey: string,
): Promise<LoadResult> {
  const { data, error } = await supabase
    .from("login_attempts")
    .select("scope, scope_key, failed_count, locked_until")
    .eq("scope", scope)
    .eq("scope_key", scopeKey)
    .maybeSingle();
  if (error) {
    console.error("loadAttempt failed", { scope, scopeKey, error });
    return { ok: false };
  }
  return { ok: true, attempt: (data as LoginAttemptState | null) ?? null };
}

async function saveAttempt(
  supabase: SupabaseClient,
  state: LoginAttemptState,
): Promise<void> {
  await supabase.from("login_attempts").upsert(
    {
      ...state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "scope,scope_key" },
  );
}

/** 只检查 IP 锁定；凭据不参与锁定决策。 */
export async function assertNotLocked(
  supabase: SupabaseClient,
  ip: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ipLoad = await loadAttempt(supabase, "ip", ip);
  if (!ipLoad.ok) {
    console.error("assertNotLocked: lock status read failed; fail closed");
    return { ok: false, error: LOCKED_ERROR };
  }

  const result = evaluateLoginLockout(ipLoad.attempt);
  if (result.locked) {
    return { ok: false, error: result.reason ?? LOCKED_ERROR };
  }
  return { ok: true };
}

/** 经 RPC 原子 upsert/increment，避免并发读改写丢计数。 */
export async function recordLoginFailure(
  supabase: SupabaseClient,
  ip: string,
  credentialId?: string | null,
): Promise<{ locked: boolean }> {
  const { data, error } = await supabase.rpc("record_login_failure_atomic", {
    p_ip: ip,
    p_credential_id: credentialId ?? null,
    p_max_failures: LOGIN_MAX_FAILURES,
    p_lock_minutes: LOGIN_LOCK_MINUTES,
  });
  if (error) {
    // fail closed：计数不可用时按已锁定处理，避免绕过
    console.error("record_login_failure_atomic failed", error);
    return { locked: true };
  }
  const payload =
    data != null && typeof data === "object"
      ? (data as Record<string, unknown>)
      : null;
  const locked = Boolean(payload && "locked" in payload && payload.locked);

  const globalAlert = Boolean(payload && payload.global_alert);
  const credentialAlert = Boolean(payload && payload.credential_alert);
  if (globalAlert) {
    console.error(
      "global login failure threshold reached (alert only, no lock)",
      {
        global_count: payload?.global_count ?? null,
        ip,
        credential_id: credentialId ?? null,
      },
    );
  }
  if (credentialAlert) {
    console.error(
      "credential login failure threshold reached (alert only, no lock)",
      {
        credential_count: payload?.credential_count ?? null,
        ip,
        credential_id: credentialId ?? null,
      },
    );
  }

  return { locked };
}

export async function recordLoginSuccess(
  supabase: SupabaseClient,
  ip: string,
  credentialId?: string | null,
): Promise<void> {
  const tasks = [saveAttempt(supabase, clearedAttemptState("ip", ip))];
  if (credentialId) {
    tasks.push(
      saveAttempt(supabase, clearedAttemptState("credential", credentialId)),
    );
  }
  await Promise.all(tasks);
}
