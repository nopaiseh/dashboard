"use client";

import {
  useCallback,
  useId,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type AgentDetailTab = "items" | "tokens";

function tabFromSearch(raw: string | null): AgentDetailTab {
  return raw === "tokens" ? "tokens" : "items";
}

export function AgentDetailTabs({
  itemsPanel,
  tokensPanel,
}: {
  itemsPanel: ReactNode;
  tokensPanel: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = tabFromSearch(searchParams.get("tab"));
  const baseId = useId();
  const itemsTabId = `${baseId}-items`;
  const tokensTabId = `${baseId}-tokens`;
  const itemsPanelId = `${baseId}-items-panel`;
  const tokensPanelId = `${baseId}-tokens-panel`;
  const tablistRef = useRef<HTMLDivElement>(null);

  const selectTab = useCallback(
    (tab: AgentDetailTab) => {
      const next = new URLSearchParams(searchParams.toString());
      if (tab === "tokens") {
        next.set("tab", "tokens");
      } else {
        next.delete("tab");
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const tabs = Array.from(
      tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
        [],
    );
    if (tabs.length === 0) return;
    const idx = tabs.indexOf(e.currentTarget);
    if (idx < 0) return;

    let nextIdx = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      nextIdx = (idx + 1) % tabs.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      nextIdx = (idx - 1 + tabs.length) % tabs.length;
    } else if (e.key === "Home") {
      nextIdx = 0;
    } else if (e.key === "End") {
      nextIdx = tabs.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    const nextTab = tabs[nextIdx];
    nextTab?.focus();
    const which = nextTab?.dataset.tab;
    if (which === "items" || which === "tokens") {
      selectTab(which);
    }
  }

  return (
    <div>
      <div
        className={"qj-tabs qj-pageTabs"}
        role="tablist"
        aria-label="专员详情"
        ref={tablistRef}
      >
        <button
          type="button"
          role="tab"
          id={itemsTabId}
          data-tab="items"
          aria-selected={active === "items"}
          aria-controls={itemsPanelId}
          tabIndex={active === "items" ? 0 : -1}
          className={`qj-tab${active === "items" ? " qj-tabOn" : ""}`}
          onClick={() => selectTab("items")}
          onKeyDown={onTabKeyDown}
        >
          事项
        </button>
        <button
          type="button"
          role="tab"
          id={tokensTabId}
          data-tab="tokens"
          aria-selected={active === "tokens"}
          aria-controls={tokensPanelId}
          tabIndex={active === "tokens" ? 0 : -1}
          className={`qj-tab${active === "tokens" ? " qj-tabOn" : ""}`}
          onClick={() => selectTab("tokens")}
          onKeyDown={onTabKeyDown}
        >
          令牌
        </button>
      </div>

      <div
        role="tabpanel"
        id={itemsPanelId}
        aria-labelledby={itemsTabId}
        hidden={active !== "items"}
      >
        {active === "items" ? itemsPanel : null}
      </div>
      <div
        role="tabpanel"
        id={tokensPanelId}
        aria-labelledby={tokensTabId}
        hidden={active !== "tokens"}
      >
        {active === "tokens" ? tokensPanel : null}
      </div>
    </div>
  );
}
