import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
} from "@/lib/env";

/**
 * 仅服务器端使用的 service role 客户端。
 * 浏览器端不得引用本模块，也不得暴露任何密钥。
 */
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

/** 测试用：注入 / 清空缓存客户端。 */
export function setServiceClientForTests(client: SupabaseClient | null): void {
  cached = client;
}
