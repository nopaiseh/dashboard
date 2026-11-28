"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { BankGoals } from "./BankGoals";
import { BankLedgerPanel } from "./BankLedgerPanel";
import { BankOverview } from "./BankOverview";
import { BankTrend } from "./BankTrend";
import type { BankViewModel } from "./bankModel";
import { BANK_TABS, type BankTabId } from "./bankTheme";

/**
 * 银行看板方案 C：页内二级菜单（概览 / 目标 / 趋势 / 流水）。
 * 金额只来自传入的 model；禁止 import 示例数据。
 */
export function BankSection({
  model,
  sampleMode = false,
  initialTab = "ov",
}: {
  model: BankViewModel;
  sampleMode?: boolean;
  initialTab?: BankTabId;
}) {
  const [tab, setTab] = useState<BankTabId>(initialTab);
  const baseId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectTab = useCallback((id: BankTabId) => {
    setTab(id);
  }, []);

  const onTabKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const last = BANK_TABS.length - 1;
      let next = index;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        next = index === last ? 0 : index + 1;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        next = index === 0 ? last : index - 1;
      } else if (e.key === "Home") {
        e.preventDefault();
        next = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        next = last;
      } else {
        return;
      }
      const id = BANK_TABS[next]!.id;
      setTab(id);
      tabRefs.current[next]?.focus();
    },
    [],
  );

  return (
    <div className={"k-bank"}>
      <nav className={"qj-subnav"} aria-label="本页栏目">
        <div role="tablist" aria-label="银行看板栏目" className={"qj-subnavTabs"}>
          {BANK_TABS.map((t, i) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${t.id}`}
                tabIndex={selected ? 0 : -1}
                className={selected ? "qj-tab on" : "qj-tab"}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                onClick={() => selectTab(t.id)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {sampleMode ? (
        <div className={"banner"} role="note">
          <b>示意数据 FAKE</b>
          此页所有数字、日期均为设计稿占位，不是真实数据。
        </div>
      ) : null}

      {BANK_TABS.map((t) => {
        const selected = tab === t.id;
        return (
          <div
            key={t.id}
            role="tabpanel"
            id={`${baseId}-panel-${t.id}`}
            aria-labelledby={`${baseId}-tab-${t.id}`}
            hidden={!selected}
          >
            {selected ? renderPanel(t.id, model, sampleMode) : null}
          </div>
        );
      })}
    </div>
  );
}

function renderPanel(
  id: BankTabId,
  model: BankViewModel,
  sampleMode: boolean,
) {
  switch (id) {
    case "ov":
      return <BankOverview model={model} sampleMode={sampleMode} />;
    case "goal":
      return <BankGoals model={model} sampleMode={sampleMode} />;
    case "trend":
      return <BankTrend model={model} sampleMode={sampleMode} />;
    case "led":
      return <BankLedgerPanel model={model} sampleMode={sampleMode} />;
  }
}
