/**
 * 银行看板前端：数据规则 + 解析 + 方案 C 渲染（FAKE 夹具）。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/components/qingjian/DashboardView";
import { BankOverview } from "@/components/qingjian/dashboard/BankOverview";
import { BankSection } from "@/components/qingjian/dashboard/BankSection";
import {
  BANK_EMPTY,
  BANK_NO_COMPARE,
  BANK_NOT_STARTED,
  asBankNumber,
  bankCompareTone,
  bankProgressFill,
  bankStatusChipKind,
  formatBankCompare,
  formatBankMoney,
  formatBankOvershootLabel,
  formatBankProgressPct,
  isBankNetNegative,
  isBankProgressOver,
  splitBankConclusionText,
  splitBankConclusionTitle,
} from "@/components/qingjian/dashboard/bankFormat";
import { buildSampleBankDashboard } from "@/components/qingjian/dashboard/fixtures/buildSampleBankBlocks";
import { categoryLabel, isBankCategory } from "@/components/qingjian/dashboard/labels";
import { parseBankModel } from "@/components/qingjian/dashboard/parseBankModel";
import type {
  DashboardBlockPublic,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";

describe("bank display rules (bankFormat)", () => {
  it("asBankNumber only accepts finite numbers", () => {
    expect(asBankNumber(0)).toBe(0);
    expect(asBankNumber(-5)).toBe(-5);
    expect(asBankNumber("100")).toBeNull();
    expect(asBankNumber(null)).toBeNull();
    expect(asBankNumber(Number.NaN)).toBeNull();
    expect(asBankNumber(Infinity)).toBeNull();
  });

  it("formatBankMoney: 缺→暂无数据；0→S$0.00；负号用 −", () => {
    expect(formatBankMoney(null)).toBe(BANK_EMPTY);
    expect(formatBankMoney(undefined)).toBe(BANK_EMPTY);
    expect(formatBankMoney("1")).toBe(BANK_EMPTY);
    expect(formatBankMoney(0)).toBe("S$0.00");
    expect(formatBankMoney(1000)).toBe("S$1,000.00");
    expect(formatBankMoney(-5000)).toBe("−S$5,000.00");
  });

  it("formatBankCompare: 缺→—；0 仍显示金额", () => {
    expect(formatBankCompare(undefined)).toBe(BANK_NO_COMPARE);
    expect(formatBankCompare(null)).toBe(BANK_NO_COMPARE);
    expect(formatBankCompare(0)).toBe("S$0.00");
    expect(formatBankCompare(-500)).toBe("S$500.00");
    expect(bankCompareTone(undefined)).toBe("empty");
    expect(bankCompareTone(0)).toBe("mut");
    expect(bankCompareTone(10)).toBe("pos");
    expect(bankCompareTone(-10)).toBe("neg");
  });

  it("progress: 无目标→未开始；>100 显示真实值并标超标", () => {
    expect(formatBankProgressPct(50, { hasTarget: false })).toBe(
      BANK_NOT_STARTED,
    );
    expect(formatBankProgressPct(null)).toBe(BANK_EMPTY);
    expect(formatBankProgressPct(50)).toBe("50%");
    expect(formatBankProgressPct(120)).toBe("120%");
    expect(isBankProgressOver(120)).toBe(true);
    expect(isBankProgressOver(100)).toBe(false);
    expect(formatBankOvershootLabel(120)).toBe("超出 20%");
    expect(bankProgressFill(120).over).toBe(true);
    expect(bankProgressFill(50).withinPct).toBe(50);
  });

  it("status chip kind + negative net", () => {
    expect(bankStatusChipKind("no_target", 0)).toBe("neutral");
    expect(bankStatusChipKind("behind", 50)).toBe("warn");
    expect(bankStatusChipKind("behind", 120)).toBe("red");
    expect(bankStatusChipKind("on_track", 60)).toBe("ok");
    expect(bankStatusChipKind("ahead", 50)).toBe("ok");
    expect(isBankNetNegative(-1)).toBe(true);
    expect(isBankNetNegative(0)).toBe(false);
    expect(isBankNetNegative(10)).toBe(false);
  });

  it("split conclusion text/title", () => {
    const { body, urgent } = splitBankConclusionText(
      "摘要一段。\n最紧：优先补足总闸户",
    );
    expect(body).toBe("摘要一段。");
    expect(urgent).toBe("优先补足总闸户");
    const parts = splitBankConclusionTitle("净额 −S$5,000：不足");
    expect(parts.some((p) => p.danger && p.text.includes("5,000"))).toBe(true);
  });
});

describe("parseBankModel (FAKE blocks)", () => {
  it("maps block_key slots and data rules", () => {
    const dash = buildSampleBankDashboard();
    const model = parseBankModel(dash.sections[0]!);
    expect(model.net?.net).toBe(-5000);
    expect(model.net?.cashTotal).toBe(5000);
    expect(isBankNetNegative(model.net!.net)).toBe(true);

    const trust = model.groups
      .flatMap((g) => g.accounts)
      .find((a) => a.accountKey === "trust");
    expect(trust?.deltaMom).toBeUndefined();
    expect(trust?.progress?.progress).toBe(120);

    const wise = model.groups
      .flatMap((g) => g.accounts)
      .find((a) => a.accountKey === "wise");
    expect(wise?.value).toBeNull();
    expect(wise?.progress?.status).toBe("no_target");

    const hsbc = model.groups
      .flatMap((g) => g.accounts)
      .find((a) => a.accountKey === "hsbc");
    expect(hsbc?.value).toBe(0);
    expect(hsbc?.deltaMom).toBe(0);

    expect(model.alloc?.rows.length).toBe(4);
    expect(model.ledger?.length).toBe(3);
    expect(model.conclusion?.urgent).toContain("优先补足");
  });

  it("missing blocks → null segments, no invented amounts", () => {
    const emptySec: DashboardSectionPublic = {
      id: "sec",
      category: "bank",
      sort_order: 0,
      agent_id: null,
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      blocks: [],
    };
    const model = parseBankModel(emptySec);
    expect(model.conclusion).toBeNull();
    expect(model.net).toBeNull();
    expect(model.groups).toEqual([]);
    expect(model.progress).toEqual([]);
    expect(model.liab).toBeNull();
  });

  it("non-number metric value → 暂无数据 path (value null)", () => {
    const block: DashboardBlockPublic = {
      id: "b1",
      section_id: "s",
      block_type: "metric",
      sort_order: 0,
      agent_id: null,
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      payload: {
        block_key: "bank_acc_wise",
        title: "Wise",
        role_tag: "外币",
        group: "fx",
        label: "2027-04-30",
        unit: "S$",
        // value intentionally missing
      },
    };
    const model = parseBankModel({
      id: "s",
      category: "bank",
      sort_order: 0,
      agent_id: null,
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      blocks: [block],
    });
    expect(model.groups[0]?.accounts[0]?.value).toBeNull();
  });
});

describe("bank UI render (FAKE)", () => {
  it("labels recognize bank category", () => {
    expect(categoryLabel("bank")).toBe("银行");
    expect(isBankCategory("Bank")).toBe(true);
  });

  it("DashboardView uses BankSection for bank category", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardView, {
        data: buildSampleBankDashboard(),
        sampleMode: true,
      }),
    );
    expect(html).toContain("role=\"tablist\"");
    expect(html).toContain("概览");
    expect(html).toContain("目标");
    expect(html).toContain("趋势");
    expect(html).toContain("流水");
    expect(html).toContain("示意数据 FAKE");
    expect(html).toContain("−S$5,000.00");
    expect(html).toContain("S$0.00");
    expect(html).toContain(BANK_NOT_STARTED);
    expect(html).toContain(BANK_EMPTY);
    expect(html).toContain("—");
    expect(html).toContain("120%");
    expect(html).not.toContain("account_number");
    expect(html).not.toContain("分享");
    expect(html).not.toContain("导出");
  });

  it("overview shows 最紧 chip and progress overshoot", () => {
    const model = parseBankModel(buildSampleBankDashboard().sections[0]!);
    const html = renderToStaticMarkup(
      createElement(BankOverview, { model, sampleMode: true }),
    );
    expect(html).toContain("最紧");
    expect(html).toContain("已超预算");
    expect(html).toContain("k-bankBarO");
  });

  it("BankSection tabs are keyboard-accessible roles", () => {
    const model = parseBankModel(buildSampleBankDashboard().sections[0]!);
    const html = renderToStaticMarkup(
      createElement(BankSection, { model, sampleMode: true }),
    );
    expect(html).toContain("role=\"tab\"");
    expect(html).toContain("role=\"tabpanel\"");
    expect(html).toContain("aria-selected=\"true\"");
  });
});
