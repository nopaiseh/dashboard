import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUrl } from "@/lib/env";

/**
 * Auth OTP 专用客户端（服务器专用 anon key）。
 * 仅用于 signInWithOtp / verifyOtp；业务数据仍走 service_role。
 */
export function getSupabaseAnonKey(): string {
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!key) {
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return "build-placeholder-anon-key";
    }
    throw new Error("Missing SUPABASE_ANON_KEY");
  }
  return key;
}

/** 每次新建，避免 verifyOtp 污染缓存的 service client。 */
export function createAuthOtpClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
