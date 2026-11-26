import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearedAttemptState,
  evaluateLoginLockout,
  LOGIN_LOCK_MINUTES,
  LOGIN_MAX_FAILURES,
  type LoginAttemptState,
} from "@/lib/login-lockout";

async function loadAttempt(
  supabase: SupabaseClient,
  scope: "ip" | "global",
  scopeKey: string,
): Promise<LoginAttemptState | null> {
  const { data } = await supabase
    .from("login_attempts")
    .select("scope, scope_key, failed_count, locked_until")
    .eq("scope", scope)
    .eq("scope_key", scopeKey)
    .maybeSingle();
  return (data as LoginAttemptState | null) ?? null;
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [ipAttempt, globalAttempt] = await Promise.all([
    loadAttempt(supabase, "ip", ip),
    loadAttempt(supabase, "global", "all"),
  ]);
  const result = evaluateLoginLockout(ipAttempt, globalAttempt);
  if (result.locked) {
    return { ok: false, error: result.reason ?? "locked" };
  }
  return { ok: true };
}

/** 经 RPC 原子 upsert/increment，避免并发读改写丢计数。 */
export async function recordLoginFailure(
  supabase: SupabaseClient,
  ip: string,
): Promise<{ locked: boolean }> {
  const { data, error } = await supabase.rpc("record_login_failure_atomic", {
    p_ip: ip,
    p_max_failures: LOGIN_MAX_FAILURES,
    p_lock_minutes: LOGIN_LOCK_MINUTES,
  });
  if (error) {
    console.error("record_login_failure_atomic failed", error);
    return { locked: false };
  }
  const locked =
    data != null &&
    typeof data === "object" &&
    "locked" in (data as object) &&
    Boolean((data as { locked: unknown }).locked);
  return { locked };
}

export async function recordLoginSuccess(
  supabase: SupabaseClient,
  ip: string,
): Promise<void> {
  await Promise.all([
    saveAttempt(supabase, clearedAttemptState("ip", ip)),
    saveAttempt(supabase, clearedAttemptState("global", "all")),
  ]);
}
