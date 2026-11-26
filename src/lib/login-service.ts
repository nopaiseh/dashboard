import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anyLocked,
  clearedAttemptState,
  isLocked,
  nextFailureState,
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
  if (anyLocked([ipAttempt, globalAttempt])) {
    return { ok: false, error: "locked: too many failed login attempts" };
  }
  return { ok: true };
}

export async function recordLoginFailure(
  supabase: SupabaseClient,
  ip: string,
): Promise<{ locked: boolean }> {
  const [ipPrev, globalPrev] = await Promise.all([
    loadAttempt(supabase, "ip", ip),
    loadAttempt(supabase, "global", "all"),
  ]);
  const ipNext = nextFailureState(ipPrev, "ip", ip);
  const globalNext = nextFailureState(globalPrev, "global", "all");
  await Promise.all([saveAttempt(supabase, ipNext), saveAttempt(supabase, globalNext)]);
  return {
    locked: isLocked(ipNext) || isLocked(globalNext),
  };
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
