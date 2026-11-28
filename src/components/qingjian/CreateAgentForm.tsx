"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import {
  createAgentWithPasskey,
  PasskeyError,
} from "@/lib/ui/passkey-client";
import { FingerprintIcon } from "./FingerprintIcon";

export function CreateAgentForm() {
  const router = useRouter();
  const slugId = useId();
  const nameId = useId();
  const areaId = useId();
  const botId = useId();

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [bot, setBot] = useState("");

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
        router.refresh();
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

  return (
    <div>
      <div className={"qj-pageTitleRow"}>
        <h2>新增专员</h2>
      </div>
      <p className={"qj-listHint"}>新增专员需重新验证通行密钥。</p>
      {error ? (
        <p className={`${"qj-banner"} ${"qj-bannerError"}`} role="alert">
          {error}
        </p>
      ) : null}
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
            新增专员
          </span>
          <span className={"qj-btnHint"}>需通行密钥确认</span>
        </button>
      </form>
    </div>
  );
}
