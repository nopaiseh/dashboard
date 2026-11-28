"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AgentWithTokens } from "@/lib/owner-agent-tokens-types";
import {
  issueAgentTokenWithPasskey,
  revokeAgentTokenWithPasskey,
} from "@/lib/ui/passkey-client";
import { FingerprintIcon } from "./FingerprintIcon";

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export function AgentTokensPanel({
  initialAgents,
  agentId,
}: {
  initialAgents: AgentWithTokens[];
  /** 若提供，只显示该专员的令牌（不展示其它专员）。 */
  agentId?: string;
}) {
  const router = useRouter();

  const agents = agentId
    ? initialAgents.filter((a) => a.id === agentId)
    : initialAgents;

  const [error, setError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<{
    token: string;
    agentSlug: string;
    idSuffix: string;
  } | null>(null);
  const [revokePrevious, setRevokePrevious] = useState(true);
  const [pending, startTransition] = useTransition();

  function refresh() {
    router.refresh();
  }

  function onIssue(targetAgentId: string) {
    setError(null);
    setIssuedToken(null);
    startTransition(async () => {
      try {
        const result = await issueAgentTokenWithPasskey({
          agentId: targetAgentId,
          revokePrevious,
        });
        setIssuedToken({
          token: result.token,
          agentSlug: result.agent_slug,
          idSuffix: result.id_suffix,
        });
        refresh();
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("已取消通行密钥验证");
          return;
        }
        setError("发令牌失败，请重试");
      }
    });
  }

  function onRevoke(targetAgentId: string, tokenId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await revokeAgentTokenWithPasskey({
          agentId: targetAgentId,
          tokenId,
        });
        refresh();
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("已取消通行密钥验证");
          return;
        }
        setError("吊销失败，请重试");
      }
    });
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      setError("复制失败，请手动选中复制");
    }
  }

  return (
    <div>
      <p className={"qj-listHint"}>
        发令牌 / 吊销均需重新验证通行密钥。明文令牌只显示一次。
      </p>

      {error ? (
        <p className={`${"qj-banner"} ${"qj-bannerError"}`} role="alert">
          {error}
        </p>
      ) : null}

      {issuedToken ? (
        <div className={`${"qj-banner"}`} role="status">
          <p>
            已为 <b>{issuedToken.agentSlug}</b> 签发令牌（…{issuedToken.idSuffix}
            ）。关闭后无法再看。
          </p>
          <p>
            <code className={"qj-tokenOnce"}>{issuedToken.token}</code>
          </p>
          <div className={"qj-actions"}>
            <button
              type="button"
              className={"qj-btn"}
              onClick={() => void copyToken(issuedToken.token)}
            >
              <span className={"qj-btnRow"}>复制令牌</span>
            </button>
            <button
              type="button"
              className={`${"qj-btn"} ${"qj-btnGhost"}`}
              onClick={() => setIssuedToken(null)}
            >
              <span className={"qj-btnRow"}>关闭</span>
            </button>
          </div>
        </div>
      ) : null}

      <label className={"qj-setupField"}>
        <span className={"qj-setupLabel"}>
          <input
            type="checkbox"
            checked={revokePrevious}
            onChange={(e) => setRevokePrevious(e.target.checked)}
            disabled={pending}
          />{" "}
          发新令牌时同时吊销该专员旧令牌（默认开启）
        </span>
      </label>

      {agents.length === 0 ? (
        <p className={"qj-empty"}>暂无专员令牌资料</p>
      ) : (
        <ul className={"qj-list"}>
          {agents.map((agent) => (
            <li key={agent.id} className={"qj-item"}>
              {!agentId ? (
                <div className={"qj-itemHead"}>
                  <span className={"qj-itemTitle"}>
                    {agent.name}{" "}
                    <span className={"qj-role"}>({agent.slug})</span>
                  </span>
                </div>
              ) : (
                <div className={"qj-itemFoot"}>
                  <span className={"qj-role"}>{agent.slug}</span>
                  {agent.area ? <span>{agent.area}</span> : null}
                  {agent.bot_id ? <span>bot: {agent.bot_id}</span> : null}
                </div>
              )}
              {!agentId ? (
                <div className={"qj-itemFoot"}>
                  <span>{agent.area || "—"}</span>
                  {agent.bot_id ? <span>bot: {agent.bot_id}</span> : null}
                </div>
              ) : null}
              {agent.tokens.length === 0 ? (
                <p className={"qj-listHint"}>尚无令牌</p>
              ) : (
                <ul className={"qj-tokenList"}>
                  {agent.tokens.map((t) => (
                    <li key={t.id}>
                      …{t.id_suffix} · 创建 {formatWhen(t.created_at)} ·{" "}
                      {t.revoked_at
                        ? `已吊销 ${formatWhen(t.revoked_at)}`
                        : "有效"}
                      {!t.revoked_at ? (
                        <>
                          {" "}
                          <button
                            type="button"
                            className={`${"qj-btn"} ${"qj-btnDanger"} ${"qj-btnCompact"}`}
                            disabled={pending}
                            onClick={() => onRevoke(agent.id, t.id)}
                          >
                            <span className={"qj-btnRow"}>
                              <FingerprintIcon />
                              吊销
                            </span>
                          </button>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              <div className={"qj-actions"}>
                <button
                  type="button"
                  className={"qj-btn"}
                  disabled={pending}
                  onClick={() => onIssue(agent.id)}
                >
                  <span className={"qj-btnRow"}>
                    <FingerprintIcon />
                    发令牌
                  </span>
                  <span className={"qj-btnHint"}>需通行密钥确认</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
