/**
 * 银行看板前端：数据规则 + 解析 + 方案 C 渲染（FAKE 夹具）。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardView } from "@/components/qingjian/DashboardView";
import { BankLedgerPanel } from "@/components/qingjian/dashboard/BankLedgerPanel";
import { BankOverview } from "@/components/qingjian/dashboard/BankOverview";
import { BankProgressBar } from "@/components/qingjian/dashboard/BankProgressBar";
import { BankSection } from "@/components/qingjian/dashboard/BankSection";
import {
  computeTrendYDomain,
  formatTrendValueLabel,
} from "@/components/qingjian/dashboard/BankTrend";
import { BankGoals } from "@/components/qingjian/dashboard/BankGoals";
import {
  BANK_EMPTY,
  BANK_NO_COMPARE,
  BANK_NOT_STARTED,
  BANK_UNITS,
  asBankNumber,
  bankCompareTone,
  bankProgressFill,
  bankStatusChipKind,
  formatBankCompare,
  formatBankMilestoneLabel,
  formatBankMoney,
  formatBankOvershootLabel,
  formatBankProgressPct,
  formatBankProgressValue,
  isBankNetNegative,
  isBankProgressOver,
  isBankUnit,
  splitBankConclusionText,
  splitBankConclusionTitle,
} from "@/components/qingjian/dashboard/bankFormat";
import { emptyBankViewModel } from "@/components/qingjian/dashboard/bankModel";
import { buildSampleBankDashboard } from "@/components/qingjian/dashboard/fixtures/buildSampleBankBlocks";
import { categoryLabel, isBankCategory } from "@/components/qingjian/dashboard/labels";
import {
  bankParserCoveredBlockKeys,
  parseBankModel,
} from "@/components/qingjian/dashboard/parseBankModel";
import { BANK_BLOCK_KEYS } from "@/lib/bank-block-keys";
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

  it("formatBankMoney: 先四舍五入到分再判正负，避免 −0.004→−S$0.00", () => {
    expect(formatBankMoney(-0.004)).toBe("S$0.00");
    expect(formatBankMoney(0.004)).toBe("S$0.00");
    expect(formatBankMoney(-0.006)).toBe("−S$0.01");
    expect(formatBankMoney(0.006)).toBe("S$0.01");
    expect(formatBankMoney(-0.004, 0)).toBe("S$0");
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

  it("BANK_UNITS / BankUnit 与后端 #40 导出名与取值一致", () => {
    // 对齐 https://github.com/nopaiseh/dashboard/pull/40 的
    // export const BANK_UNITS = ["S$", "月"] as const
    expect(BANK_UNITS).toEqual(["S$", "月"]);
    expect(isBankUnit("S$")).toBe(true);
    expect(isBankUnit("月")).toBe(true);
    expect(isBankUnit("个月")).toBe(false);
    expect(isBankUnit("USD")).toBe(false);
  });

  it("formatBankProgressValue: S$ 保持金额格式", () => {
    expect(formatBankProgressValue(1000, "S$")).toBe("S$1,000.00");
    expect(formatBankProgressValue(0, "S$")).toBe("S$0.00");
    expect(formatBankProgressValue(-500, "S$")).toBe("−S$500.00");
    expect(formatBankProgressValue(null, "S$")).toBe(BANK_EMPTY);
  });

  it("formatBankProgressValue: 月 →「N 个月」；主数值组合", () => {
    expect(formatBankProgressValue(0, "月")).toBe("0 个月");
    expect(formatBankProgressValue(12, "月")).toBe("12 个月");
    expect(formatBankProgressValue(1.6, "月")).toBe("2 个月");
    expect(
      `${formatBankProgressValue(0, "月")} / ${formatBankProgressValue(12, "月")}`,
    ).toBe("0 个月 / 12 个月");
  });

  it("formatBankMilestoneLabel: 月不用 S$，S$ 保持金额", () => {
    expect(formatBankMilestoneLabel("2027-12", 12, "月")).toBe(
      "2027-12 · 12 个月",
    );
    expect(formatBankMilestoneLabel("2027-06", 4000, "S$")).toBe(
      "2027-06 · S$4,000.00",
    );
    expect(formatBankMilestoneLabel("2027-12", 12, "S$")).not.toBe(
      "2027-12 · 12 个月",
    );
  });

  it("formatBankProgressValue: 未知 unit 只显示数字", () => {
    expect(formatBankProgressValue(12, "USD")).toBe("12");
    expect(formatBankProgressValue(12, "个月")).toBe("12");
    expect(formatBankProgressValue(1000.5, "xyz")).toBe("1,000.50");
    expect(formatBankProgressValue(12, undefined)).toBe("12");
    expect(formatBankMilestoneLabel("2027-12", 12, "pts")).toBe(
      "2027-12 · 12",
    );
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

  it("trend series points are sorted ascending by month (server order not trusted)", () => {
    const block: DashboardBlockPublic = {
      id: "trend-unsorted",
      section_id: "s",
      block_type: "chart_series",
      sort_order: 0,
      agent_id: null,
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      payload: {
        block_key: "bank_trend_hsbc",
        title: "HSBC FAKE",
        account_key: "hsbc",
        series: [
          { t: "2027-03", v: 300, phase: "actual" },
          { t: "2027-01", v: 100, phase: "actual" },
          { t: "2027-02", v: 200, phase: "actual" },
        ],
        range_default: "12m",
        unit: "S$",
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
    expect(model.trends[0]?.points.map((p) => p.t)).toEqual([
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
  });

  it("ledger skips bad JSON items without throwing", () => {
    const block: DashboardBlockPublic = {
      id: "ledger-bad",
      section_id: "s",
      block_type: "list",
      sort_order: 0,
      agent_id: null,
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      payload: {
        block_key: "bank_ledger",
        title: "流水",
        items: [
          "NOT_JSON{{{",
          JSON.stringify({
            month: "2027-02",
            in_total: 10,
            out_total: 5,
            lines: [{ kind: "in", category: "salary", amount: 10 }],
          }),
          "{broken",
          JSON.stringify({ month: "nope" }),
        ],
      },
    };
    const section: DashboardSectionPublic = {
      id: "s",
      category: "bank",
      sort_order: 0,
      agent_id: null,
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      blocks: [block],
    };
    expect(() => parseBankModel(section)).not.toThrow();
    const model = parseBankModel(section);
    expect(model.ledger).toHaveLength(1);
    expect(model.ledger?.[0]?.month).toBe("2027-02");
    const html = renderToStaticMarkup(
      createElement(BankLedgerPanel, { model, sampleMode: true }),
    );
    expect(html).toContain("2027-02");
    expect(html).not.toContain("NOT_JSON");
  });

  it("covers all 28 bank block_key whitelist slots from #35", () => {
    expect(BANK_BLOCK_KEYS).toHaveLength(28);
    const covered = bankParserCoveredBlockKeys();
    expect(covered).toHaveLength(28);
    expect(covered).toEqual([...BANK_BLOCK_KEYS].sort());
  });

  it("parses progress unit from payload (月 / S$); streak 缺省为月", () => {
    const dash = buildSampleBankDashboard();
    const model = parseBankModel(dash.sections[0]!);
    const hsbc = model.progress.find((p) => p.accountKey === "hsbc");
    expect(hsbc?.unit).toBe("月");
    expect(hsbc?.value).toBe(1);
    expect(hsbc?.target).toBe(6);

    const hub = model.progress.find((p) => p.accountKey === "ocbc_salary");
    expect(hub?.unit).toBe("S$");

    const streakNoUnit: DashboardBlockPublic = {
      id: "prog-streak",
      section_id: "s",
      block_type: "progress",
      sort_order: 0,
      agent_id: null,
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      payload: {
        block_key: "bank_prog_hsbc",
        title: "FAKE 连续全额",
        account_key: "hsbc",
        kind: "streak",
        value: 0,
        target: 12,
        progress: 0,
        due: "2027-12",
        status: "on_track",
        status_text: "FAKE",
        milestones: [{ t: "2027-12", amount: 12 }],
        label: "FAKE",
        note: "",
        // unit intentionally omitted → streak 缺省「月」
      },
    };
    const parsed = parseBankModel({
      id: "s",
      category: "bank",
      sort_order: 0,
      agent_id: null,
      created_at: "2027-01-01T00:00:00.000Z",
      updated_at: "2027-01-01T00:00:00.000Z",
      blocks: [streakNoUnit],
    });
    expect(parsed.progress[0]?.unit).toBe("月");
  });
});

describe("bank trend Y domain", () => {
  it("uses data min/max (including negatives); does not force 0 as floor", () => {
    const pos = computeTrendYDomain([1200, 3400, 2800]);
    expect(pos.yMin).toBeGreaterThan(0);
    expect(pos.yMax).toBeGreaterThanOrEqual(3400);

    const mixed = computeTrendYDomain([-5000, -1000, 2000]);
    expect(mixed.yMin).toBeLessThanOrEqual(-5000);
    expect(mixed.yMax).toBeGreaterThanOrEqual(2000);
    expect(mixed.yMin).toBeLessThan(0);
    expect(mixed.yMax).toBeGreaterThan(0);

    const allNeg = computeTrendYDomain([-8000, -2000]);
    expect(allNeg.yMax).toBeLessThanOrEqual(0);
    expect(allNeg.yMin).toBeLessThanOrEqual(-8000);
  });

  it("trend value label keeps minus sign after stripping S$", () => {
    expect(formatTrendValueLabel(-1234)).toBe("−1,234");
    expect(formatTrendValueLabel(1234)).toBe("1,234");
    expect(formatTrendValueLabel(-1234.5)).toBe("−1,234.50");
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

  it("ledger panel sorts months descending", () => {
    const model = emptyBankViewModel();
    model.ledger = [
      {
        month: "2027-01",
        inTotal: 1,
        outTotal: 0,
        lines: [{ kind: "in", category: "salary", amount: 1 }],
      },
      {
        month: "2027-03",
        inTotal: 3,
        outTotal: 0,
        lines: [{ kind: "in", category: "salary", amount: 3 }],
      },
      {
        month: "2027-02",
        inTotal: 2,
        outTotal: 0,
        lines: [{ kind: "in", category: "salary", amount: 2 }],
      },
    ];
    const html = renderToStaticMarkup(
      createElement(BankLedgerPanel, { model, sampleMode: true }),
    );
    const iMar = html.indexOf("2027-03");
    const iFeb = html.indexOf("2027-02");
    const iJan = html.indexOf("2027-01");
    expect(iMar).toBeGreaterThanOrEqual(0);
    expect(iFeb).toBeGreaterThan(iMar);
    expect(iJan).toBeGreaterThan(iFeb);
  });

  it("progress bar exposes clamped aria-valuenow and real valuetext when >100%", () => {
    const over = renderToStaticMarkup(
      createElement(BankProgressBar, { progress: 120 }),
    );
    expect(over).toContain('role="progressbar"');
    expect(over).toContain('aria-valuemin="0"');
    expect(over).toContain('aria-valuemax="100"');
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain('aria-valuetext="120%"');

    const mid = renderToStaticMarkup(
      createElement(BankProgressBar, { progress: 42 }),
    );
    expect(mid).toContain('aria-valuenow="42"');
    expect(mid).toContain('aria-valuetext="42%"');
  });

  it("empty progress bar aria-valuetext is 暂无数据 (not 0%)", () => {
    const empty = renderToStaticMarkup(
      createElement(BankProgressBar, { progress: null }),
    );
    expect(empty).toContain('role="progressbar"');
    expect(empty).toContain(`aria-valuetext="${BANK_EMPTY}"`);
    expect(empty).not.toContain('aria-valuetext="0%"');

    const missing = renderToStaticMarkup(
      createElement(BankProgressBar, { progress: undefined }),
    );
    expect(missing).toContain(`aria-valuetext="${BANK_EMPTY}"`);
  });

  it("goals: 月 unit 主数值与里程碑；aria-valuetext 与可见文字一致", () => {
    const model = parseBankModel(buildSampleBankDashboard().sections[0]!);
    const html = renderToStaticMarkup(
      createElement(BankGoals, { model, sampleMode: true }),
    );
    expect(html).toContain("1 个月 / 6 个月");
    expect(html).toContain("2027-10 · 6 个月");
    expect(html).not.toContain("2027-10 S$");
    expect(html).toContain('aria-valuetext="1 个月 / 6 个月"');
    // S$ 进度里程碑仍为金额
    expect(html).toContain("2027-12 · S$10,000.00");
  });
});
