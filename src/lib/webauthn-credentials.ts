import "server-only";

import { getServiceClient } from "@/lib/supabase/server";

/**
 * 服务端判断是否已有通行密钥凭据。
 * 仅返回布尔值，不暴露数量、id 或其它详情。
 * 任何异常（含 env 缺失导致 getServiceClient 抛错、查询失败）均 fail-closed 为 true，
 * 避免误开首次注册入口或让调用页空白。
 */
export async function hasWebAuthnCredential(): Promise<boolean> {
  try {
    const supabase = getServiceClient();
    const { count, error } = await supabase
      .from("webauthn_credentials")
      .select("credential_id", { count: "exact", head: true });

    if (error) {
      return true;
    }
    return (count ?? 0) > 0;
  } catch {
    return true;
  }
}
