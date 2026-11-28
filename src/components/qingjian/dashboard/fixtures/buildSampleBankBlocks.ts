/**
 * 仅夹具 / 测试 / 截图：编成 bank block_key 对齐的 blocks。
 * 生产代码不得引用本文件。全部为 FAKE。
 */
import type {
  DashboardBlockPublic,
  DashboardReadResult,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";
import {
  BANK_FAKE_ACCOUNTS,
  BANK_FAKE_ALLOC,
  BANK_FAKE_ASSUMPTIONS,
  BANK_FAKE_AS_OF,
  BANK_FAKE_CONCLUSION,
  BANK_FAKE_LEDGER,
  BANK_FAKE_LIAB,
  BANK_FAKE_NET,
  BANK_FAKE_PROGRESS,
  BANK_FAKE_TODOS,
  BANK_FAKE_TRENDS,
  bankFakeTrendSeries,
} from "./bankSampleData";

const NOW = "2027-04-30T00:00:00.000Z";
const AGENT = "00000000-0000-4000-8000-0000000000b1";
const SEC = "sec-bank-fake";

function blk(
  id: string,
  block_type: DashboardBlockPublic["block_type"],
  sort_order: number,
  payload: Record<string, unknown>,
): DashboardBlockPublic {
  return {
    id,
    section_id: SEC,
    block_type,
    sort_order,
    payload,
    agent_id: AGENT,
    created_at: NOW,
    updated_at: NOW,
  };
}

/** FAKE：组装完整银行分区 blocks。 */
export function buildSampleBankBlocks(): DashboardBlockPublic[] {
  const blocks: DashboardBlockPublic[] = [];
  let order = 0;

  blocks.push(
    blk("bank-conclusion", "text", order++, {
      block_key: "bank_conclusion",
      title: BANK_FAKE_CONCLUSION.title,
      text: BANK_FAKE_CONCLUSION.text,
    }),
  );

  for (const acc of BANK_FAKE_ACCOUNTS) {
    const payload: Record<string, unknown> = {
      block_key: acc.block_key,
      title: acc.title,
      role_tag: acc.role_tag,
      group: acc.group,
      label: BANK_FAKE_AS_OF,
      unit: "S$",
    };
    if ("value" in acc && typeof acc.value === "number") {
      payload.value = acc.value;
    }
    if ("delta_mom" in acc && typeof acc.delta_mom === "number") {
      payload.delta_mom = acc.delta_mom;
    }
    if ("ytd" in acc && typeof acc.ytd === "number") {
      payload.ytd = acc.ytd;
    }
    blocks.push(blk(`bank-acc-${acc.key}`, "metric", order++, payload));
  }

  blocks.push(
    blk("bank-net", "metric", order++, {
      block_key: "bank_net",
      ...BANK_FAKE_NET,
      unit: "S$",
    }),
  );

  for (const prog of BANK_FAKE_PROGRESS) {
    blocks.push(
      blk(`bank-prog-${prog.block_key}`, "progress", order++, {
        ...prog,
      }),
    );
  }

  blocks.push(
    blk("bank-liab", "list", order++, {
      block_key: "bank_liab",
      title: "待扣负债",
      items: BANK_FAKE_LIAB.map((x) => JSON.stringify(x)),
    }),
  );

  blocks.push(
    blk("bank-todos", "list", order++, {
      block_key: "bank_todos",
      title: "待办",
      items: BANK_FAKE_TODOS.map((x) => JSON.stringify(x)),
    }),
  );

  blocks.push(
    blk("bank-alloc", "list", order++, {
      block_key: "bank_alloc",
      month: BANK_FAKE_ALLOC.month,
      title: BANK_FAKE_ALLOC.title,
      items: BANK_FAKE_ALLOC.rows.map((x) => JSON.stringify(x)),
    }),
  );

  for (const tr of BANK_FAKE_TRENDS) {
    blocks.push(
      blk(`bank-trend-${tr.account_key}`, "chart_series", order++, {
        block_key: tr.block_key,
        title: tr.title,
        account_key: tr.account_key,
        series: bankFakeTrendSeries(tr.actual, tr.projected),
        range_default: "12m",
        unit: "S$",
      }),
    );
  }

  blocks.push(
    blk("bank-ledger", "list", order++, {
      block_key: "bank_ledger",
      title: "流水",
      items: BANK_FAKE_LEDGER.map((x) => JSON.stringify(x)),
    }),
  );

  blocks.push(
    blk("bank-assumptions", "text", order++, {
      block_key: "bank_assumptions",
      text: BANK_FAKE_ASSUMPTIONS,
    }),
  );

  return blocks;
}

export function buildSampleBankSection(): DashboardSectionPublic {
  return {
    id: SEC,
    category: "bank",
    sort_order: 2,
    agent_id: AGENT,
    created_at: NOW,
    updated_at: NOW,
    blocks: buildSampleBankBlocks(),
  };
}

/** FAKE 银行详情页数据（仅 bank 分区）。 */
export function buildSampleBankDashboard(): DashboardReadResult {
  return {
    headline: "银行户口 · FAKE",
    sections: [buildSampleBankSection()],
  };
}
