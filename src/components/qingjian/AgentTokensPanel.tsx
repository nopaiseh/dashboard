"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import type { AgentWithTokens } from "@/lib/owner-agent-tokens-types";
import {
  createAgentWithPasskey,
  issueAgentTokenWithPasskey,
  PasskeyError,
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
}: {
  initialAgents: AgentWithTokens[];
}) {
  const router = useRouter();
  const slugId = useId();
  const nameId = useId();
  const areaId = useId();
  const botId = useId();

  const [error, setError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<{
    token: string;
    agentSlug: string;
    idSuffix: string;
  } | null>(null);
  const [revokePrevious, setRevokePrevious] = useState(true);
  const [pending, startTransition] = useTransition();

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [bot, setBot] = useState("");

  function refresh() {
    router.refresh();
  }

  function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createAgentWithPasskey({
          slug: slug.trim(),
          name: name.trim(),
          area: area.trim(),
          botId: bot.trim() ? bot.trim() : null,
        });
        setSlug("");
        setName("");
        setArea("");
        setBot("");
        refresh();
      } catch (err) {
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("已取消通行密钥验证");
          return;
        }
        if (err instanceof PasskeyError && err.status === 409) {
          setError("slug 已存在");
          return;
        }
        setError("新增失败，请重试");
      }
    });
  }

  function onIssue(agentId: string) {
    setError(null);
    setIssuedToken(null);
    startTransition(async () => {
      try {
        const result = await issueAgentTokenWithPasskey({
          agentId,
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

  function onRevoke(agentId: string, tokenId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await revokeAgentTokenWithPasskey({ agentId, tokenId });
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
        发令牌 / 吊销 / 新增姐妹均需重新验证通行密钥。明文令牌只显示一次。
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
          发新令牌时同时吊销该姐妹旧令牌（默认开启）
        </span>
      </label>

      {initialAgents.length === 0 ? (
        <p className={"qj-empty"}>暂无姐妹</p>
      ) : (
        <ul className={"qj-list"}>
          {initialAgents.map((agent) => (
            <li key={agent.id} className={"qj-item"}>
              <div className={"qj-itemHead"}>
                <span className={"qj-itemTitle"}>
                  {agent.name}{" "}
                  <span className={"qj-role"}>({agent.slug})</span>
                </span>
              </div>
              <div className={"qj-itemFoot"}>
                <span>{agent.area || "—"}</span>
                {agent.bot_id ? <span>bot: {agent.bot_id}</span> : null}
              </div>
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

      <div className={"qj-pageTitleRow"}>
        <h2>新增姐妹</h2>
      </div>
      <form className={"qj-setupForm"} onSubmit={onCreate}>
        <div className={"qj-setupField"}>
          <label htmlFor={slugId} className={"qj-setupLabel"}>
            slug（小写 kebab-case）
          </label>
          <input
            id={slugId}
            className={"qj-setupInput"}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="^[a-z0-9]+(?:-[a-z0-9]+)*$"
            minLength={2}
            maxLength={64}
            required
            disabled={pending}
          />
        </div>
        <div className={"qj-setupField"}>
          <label htmlFor={nameId} className={"qj-setupLabel"}>
            名称
          </label>
          <input
            id={nameId}
            className={"qj-setupInput"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            required
            disabled={pending}
          />
        </div>
        <div className={"qj-setupField"}>
          <label htmlFor={areaId} className={"qj-setupLabel"}>
            领域
          </label>
          <input
            id={areaId}
            className={"qj-setupInput"}
            value={area}
            onChange={(e) => setArea(e.target.value)}
            maxLength={100}
            disabled={pending}
          />
        </div>
        <div className={"qj-setupField"}>
          <label htmlFor={botId} className={"qj-setupLabel"}>
            bot_id（可选）
          </label>
          <input
            id={botId}
            className={"qj-setupInput"}
            value={bot}
            onChange={(e) => setBot(e.target.value)}
            maxLength={128}
            disabled={pending}
          />
        </div>
        <button type="submit" className={"qj-btn"} disabled={pending}>
          <span className={"qj-btnRow"}>
            <FingerprintIcon />
            新增姐妹
          </span>
          <span className={"qj-btnHint"}>需通行密钥确认</span>
        </button>
      </form>
    </div>
  );
}
