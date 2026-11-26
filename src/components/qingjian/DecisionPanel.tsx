"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { ItemOption, ItemRow } from "@/lib/types";
import { ALLOWED_DECISIONS_BY_KIND } from "@/lib/types";
import { decisionActionsBlocked } from "@/lib/ui/decision-disabled";
import {
  decideWithPasskey,
  PasskeyError,
  type DecisionAction,
} from "@/lib/ui/passkey-client";
import { ConfirmSheet } from "./ConfirmSheet";
import { FingerprintIcon } from "./FingerprintIcon";

function useIsMobileNarrow(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)");
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return mobile;
}

export function DecisionPanel({
  item,
}: {
  item: Pick<
    ItemRow,
    "id" | "kind" | "status" | "title" | "options" | "content_hash" | "decrypt_failed"
  >;
}) {
  const router = useRouter();
  const mobile = useIsMobileNarrow();
  const allowed = ALLOWED_DECISIONS_BY_KIND[item.kind];
  const options = (item.options ?? []) as ItemOption[];
  const [optionKey, setOptionKey] = useState(options[0]?.key ?? "");
  const [replyText, setReplyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { blocked: decryptBlocked, reason: decryptBlockReason } =
    decisionActionsBlocked(item);

  if (item.status !== "open") {
    return null;
  }

  const selectedLabel =
    options.find((o) => o.key === optionKey)?.label ?? null;

  function runDecision(action: DecisionAction) {
    if (decryptBlocked) {
      setError(decryptBlockReason);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await decideWithPasskey({
          itemId: item.id,
          action,
          contentHash: item.content_hash,
          optionKey: options.length ? optionKey || undefined : undefined,
          replyText: action === "reply" ? replyText : undefined,
        });
        setSheetOpen(false);
        router.refresh();
      } catch (err) {
        if (err instanceof PasskeyError && err.status === 409) {
          setError("内容已变化，请刷新后重试");
          setSheetOpen(false);
          router.refresh();
          return;
        }
        if (err instanceof Error && err.name === "NotAllowedError") {
          setError("已取消通行密钥验证");
          return;
        }
        setError("操作失败，请重试");
      }
    });
  }

  function onApproveClick() {
    if (decryptBlocked) {
      setError(decryptBlockReason);
      return;
    }
    if (mobile) {
      setSheetOpen(true);
      return;
    }
    runDecision("approve");
  }

  const actionsDisabled = pending || decryptBlocked;

  return (
    <div>
      {options.length > 0 ? (
        <div className={"qj-options"} role="radiogroup" aria-label="选项">
          {options.map((opt) => {
            const picked = opt.key === optionKey;
            return (
              <label
                key={opt.key}
                className={`${"qj-opt"} ${picked ? "qj-optPicked" : ""}`}
              >
                <input
                  type="radio"
                  name="item-option"
                  value={opt.key}
                  checked={picked}
                  onChange={() => setOptionKey(opt.key)}
                  disabled={decryptBlocked}
                />
                {opt.label}
              </label>
            );
          })}
        </div>
      ) : null}

      {allowed.has("reply") ? (
        <label className="qj-sr-only" htmlFor="reply-text">
          回复内容
        </label>
      ) : null}
      {allowed.has("reply") ? (
        <textarea
          id="reply-text"
          className={"qj-replyBox"}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="写下回复…"
          maxLength={5000}
          disabled={decryptBlocked}
        />
      ) : null}

      {decryptBlocked && decryptBlockReason ? (
        <p className={`${"qj-banner"} ${"qj-bannerError"}`} role="status">
          {decryptBlockReason}
        </p>
      ) : null}

      {error ? (
        <p className={`${"qj-banner"} ${"qj-bannerError"}`} role="alert">
          {error}
        </p>
      ) : null}

      <div className={"qj-actions"}>
        {allowed.has("approve") ? (
          <button
            type="button"
            className={"qj-btn"}
            onClick={onApproveClick}
            disabled={actionsDisabled}
            title={decryptBlockReason ?? undefined}
            aria-disabled={actionsDisabled}
          >
            <span className={"qj-btnRow"}>
              <FingerprintIcon />
              批准
            </span>
            <span className={"qj-btnHint"}>
              {decryptBlocked
                ? decryptBlockReason
                : "需通行密钥确认"}
            </span>
          </button>
        ) : null}
        {allowed.has("reject") ? (
          <button
            type="button"
            className={`${"qj-btn"} ${"qj-btnDanger"}`}
            onClick={() => runDecision("reject")}
            disabled={actionsDisabled}
            title={decryptBlockReason ?? undefined}
            aria-disabled={actionsDisabled}
          >
            <span className={"qj-btnRow"}>
              <FingerprintIcon />
              驳回
            </span>
            <span className={"qj-btnHint"}>
              {decryptBlocked
                ? decryptBlockReason
                : "需通行密钥确认"}
            </span>
          </button>
        ) : null}
        {allowed.has("reply") ? (
          <button
            type="button"
            className={`${"qj-btn"} ${"qj-btnGhost"}`}
            onClick={() => runDecision("reply")}
            disabled={actionsDisabled || !replyText.trim()}
            title={decryptBlockReason ?? undefined}
            aria-disabled={actionsDisabled || !replyText.trim()}
          >
            <span className={"qj-btnRow"}>
              <FingerprintIcon />
              回复
            </span>
            <span className={"qj-btnHint"}>
              {decryptBlocked
                ? decryptBlockReason
                : "需通行密钥确认"}
            </span>
          </button>
        ) : null}
      </div>

      <ConfirmSheet
        open={sheetOpen && !decryptBlocked}
        title={item.title}
        optionLabel={selectedLabel}
        busy={pending}
        error={error}
        onConfirm={() => runDecision("approve")}
        onCancel={() => setSheetOpen(false)}
      />
    </div>
  );
}
