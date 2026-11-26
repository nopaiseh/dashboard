"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { Counts } from "@/lib/ui/data";
import { formatHeaderDate } from "@/lib/ui/format";
import { NAV_TABS, type NavTabId } from "@/lib/ui/labels";

const PRIMARY_MOBILE = new Set(["today", "pending", "todo", "qa-in"]);

function countFor(
  id: NavTabId,
  counts: Counts | null,
): number | null {
  if (!counts) return null;
  switch (id) {
    case "pending":
      return counts.approval;
    case "todo":
      return counts.todo;
    case "qa-in":
      return counts.question_to_user;
    case "qa-out":
      return counts.question_from_user;
    case "waiting":
      return counts.waiting;
    case "held":
      return counts.held;
    default:
      return null;
  }
}

export function TopNav({
  active,
  counts,
  siteName,
}: {
  active: NavTabId;
  counts: Counts | null;
  siteName: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const secondaryActive = !PRIMARY_MOBILE.has(active);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header className={"qj-top"}>
      <div className={"qj-brandRow"}>
        <Link href="/" className={"qj-brand"}>
          {siteName}
        </Link>
        <div className={"qj-meta"}>{formatHeaderDate()}</div>
      </div>
      <nav className={`${"qj-tabs"} ${"qj-desktopTabs"}`} aria-label="栏目">
        {NAV_TABS.map((tab) => {
          const n = countFor(tab.id, counts);
          const on = tab.id === active;
          const mobileHidden = !PRIMARY_MOBILE.has(tab.id);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={[
                "qj-tab",
                on ? "qj-tabOn" : "",
                mobileHidden ? "qj-desktopOnly" : "",
                !tab.primary ? "qj-tabSec" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-current={on ? "page" : undefined}
            >
              {tab.label}
              {n != null && n > 0 ? (
                <span className={"qj-tabN"}>{n}</span>
              ) : null}
            </Link>
          );
        })}
        <div className={`${"qj-moreWrap"} ${"qj-mobileOnly"}`} ref={wrapRef}>
          <button
            type="button"
            className={`${"qj-moreBtn"} ${secondaryActive ? "qj-moreBtnOn" : ""}`}
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((v) => !v)}
          >
            更多
          </button>
          {open ? (
            <div id={menuId} className={"qj-moreMenu"} role="menu">
              {NAV_TABS.filter((t) => !PRIMARY_MOBILE.has(t.id)).map((tab) => {
                const n = countFor(tab.id, counts);
                const on = tab.id === active;
                return (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    role="menuitem"
                    className={`${"qj-moreLink"} ${on ? "qj-moreLinkOn" : ""}`}
                    onClick={() => setOpen(false)}
                  >
                    {tab.label}
                    {n != null && n > 0 ? ` ${n}` : ""}
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
