"use client";

import { useEffect, useId, useRef } from "react";
import { FingerprintIcon } from "./FingerprintIcon";

export function ConfirmSheet({
  open,
  title,
  optionLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  optionLabel: string | null;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      className={"qj-overlay"}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className={"qj-sheet"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={"qj-handle"} aria-hidden="true" />
        <h2 id={titleId}>确认批准</h2>
        <p className={"qj-what"}>{title}</p>
        {optionLabel ? (
          <p className={"qj-what"}>选项：{optionLabel}</p>
        ) : null}
        <p className={"qj-need"}>
          <FingerprintIcon />
          将再次验证通行密钥（指纹或面容）
        </p>
        <div className={"qj-fpMark"} aria-hidden="true">
          <FingerprintIcon large />
        </div>
        {error ? (
          <p className={`${"qj-banner"} ${"qj-bannerError"}`} role="alert">
            {error}
          </p>
        ) : null}
        <div className={"qj-actions"}>
          <button
            type="button"
            className={"qj-btn"}
            onClick={onConfirm}
            disabled={busy}
          >
            <span className={"qj-btnRow"}>
              <FingerprintIcon />
              {busy ? "验证中…" : "验证并批准"}
            </span>
            <span className={"qj-btnHint"}>需通行密钥确认</span>
          </button>
          <button
            ref={closeRef}
            type="button"
            className={`${"qj-btn"} ${"qj-btnGhost"}`}
            onClick={onCancel}
            disabled={busy}
          >
            <span className={"qj-btnRow"}>取消</span>
          </button>
        </div>
      </div>
    </div>
  );
}
