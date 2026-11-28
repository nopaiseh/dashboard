/** 客户端/服务端共用的所有者令牌列表类型（无 server-only）。 */

export interface AgentTokenListItem {
  id: string;
  id_suffix: string;
  created_at: string;
  revoked_at: string | null;
}

export interface AgentWithTokens {
  id: string;
  slug: string;
  name: string;
  area: string;
  bot_id: string | null;
  created_at: string;
  tokens: AgentTokenListItem[];
}
