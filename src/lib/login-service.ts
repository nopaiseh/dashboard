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

export async function assertNotLocked(
  supabase: SupabaseClient,
  ip: string,
  credentialId?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loads: Array<Promise<LoadResult>> = [
    loadAttempt(supabase, "ip", ip),
  ];
  if (credentialId) {
    loads.push(loadAttempt(supabase, "credential", credentialId));
  }

  const results = await Promise.all(loads);
  if (results.some((r) => !r.ok)) {
    console.error("assertNotLocked: lock status read failed; fail closed");
    return { ok: false, error: LOCKED_ERROR };
  }

  const ipAttempt = results[0]!.ok ? results[0].attempt : null;
  const credentialAttempt =
    credentialId && results[1]?.ok ? results[1].attempt : null;

  const result = evaluateLoginLockout(ipAttempt, credentialAttempt);
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
    data != null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const locked = Boolean(payload && "locked" in payload && payload.locked);

  const globalCount =
    payload && typeof payload.global_count === "number"
      ? payload.global_count
      : null;
  const globalAlert = Boolean(payload && payload.global_alert);
  if (
    globalAlert ||
    (globalCount != null && globalCount >= LOGIN_MAX_FAILURES)
  ) {
    console.error("global login failure threshold reached (alert only, no lock)", {
      global_count: globalCount,
      ip,
      credential_id: credentialId ?? null,
    });
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
