import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/env";

export function createServiceClient(): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let cached: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (!cached) {
    cached = createServiceClient();
  }
  return cached;
}

export function setServiceClientForTests(client: SupabaseClient | null): void {
  cached = client;
}
