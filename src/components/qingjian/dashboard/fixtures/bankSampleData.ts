/**
 * FAKE 银行看板夹具数据（示意，非真实余额）。
 * 仅测试 / 截图使用；生产路径不得引用。
 */

export const BANK_FAKE_AS_OF = "2027-04-30";

export const BANK_FAKE_CONCLUSION = {
  title: "净额 −S$5,000：现金不足以覆盖待扣负债",
  text: [
    "现金合计 S$5,000，待扣负债 S$10,000，净额为负，需优先补足总闸户。",
    "最紧：净额为负 S$5,000，优先补足总闸户至留存线；Trust 本月已超预算 S$200。",
  ].join("\n"),
};

/** FAKE accounts — value omitted on wise → UI「暂无数据」 */
export const BANK_FAKE_ACCOUNTS = [
  {
    key: "ocbc_salary" as const,
    block_key: "bank_acc_ocbc_salary" as const,
    title: "OCBC 总闸户",
    role_tag: "工资入账·分流",
    group: "hub" as const,
    value: 1000,
    delta_mom: -500,
    ytd: -1000,
  },
  {
    key: "hsbc" as const,
    block_key: "bank_acc_hsbc" as const,
    title: "HSBC",
    role_tag: "固定扣款",
    group: "fixed" as const,
    value: 0,
    delta_mom: 0,
    ytd: 0,
  },
  {
    key: "trust" as const,
    block_key: "bank_acc_trust" as const,
    title: "Trust",
    role_tag: "日常刷卡",
    group: "daily" as const,
    value: 500,
    // 首月无上月可比：不写 delta_mom / ytd
  },
  {
    key: "posb" as const,
    block_key: "bank_acc_posb" as const,
    title: "POSB",
    role_tag: "现金·交通",
    group: "daily" as const,
    value: 500,
    delta_mom: 100,
    ytd: 200,
  },
  {
    key: "ocbc_savings" as const,
    block_key: "bank_acc_ocbc_savings" as const,
    title: "OCBC 储蓄",
    role_tag: "应急金",
    group: "savings" as const,
    value: 2000,
    delta_mom: 1000,
    ytd: 2000,
  },
  {
    key: "gxs" as const,
    block_key: "bank_acc_gxs" as const,
    title: "GXS",
    role_tag: "高息储蓄",
    group: "savings" as const,
    value: 1000,
    delta_mom: 500,
    ytd: 1000,
  },
  {
    key: "wise" as const,
    block_key: "bank_acc_wise" as const,
    title: "Wise",
    role_tag: "外币",
    group: "fx" as const,
    // value 故意省略 → 解析为缺数据
  },
];

export const BANK_FAKE_NET = {
  value: -5000,
  cash_total: 5000,
  liab_total: 10000,
  label: BANK_FAKE_AS_OF,
};

export const BANK_FAKE_PROGRESS = [
  {
    block_key: "bank_prog_hub" as const,
    title: "总闸留存线",
    account_key: "ocbc_salary" as const,
    kind: "floor" as const,
    value: 1000,
    target: 2000,
    progress: 50,
    due: "2027-12",
    status: "behind" as const,
    status_text: "低于留存线 S$1,000",
    milestones: [] as Array<{ t: string; amount: number }>,
    label: `截至 ${BANK_FAKE_AS_OF}`,
    note: "余额不应低于留存线",
  },
  {
    block_key: "bank_prog_hsbc" as const,
    title: "HSBC 全额还清",
    account_key: "hsbc" as const,
    kind: "streak" as const,
    value: 1,
    target: 6,
    progress: 17,
    due: "2027-10",
    status: "on_track" as const,
    status_text: "连续 1 个月全额",
    milestones: [],
    label: `截至 ${BANK_FAKE_AS_OF}`,
    note: "",
  },
  {
    block_key: "bank_prog_trust" as const,
    title: "Trust 月预算",
    account_key: "trust" as const,
    kind: "budget" as const,
    value: 1200,
    target: 1000,
    progress: 120,
    due: "2027-04",
    status: "behind" as const,
    status_text: "已超预算 S$200",
    milestones: [],
    label: `截至 ${BANK_FAKE_AS_OF}`,
    note: "餐饮、订阅",
  },
  {
    block_key: "bank_prog_posb" as const,
    title: "POSB 月预算",
    account_key: "posb" as const,
    kind: "budget" as const,
    value: 300,
    target: 500,
    progress: 60,
    due: "2027-04",
    status: "on_track" as const,
    status_text: "预算内",
    milestones: [],
    label: `截至 ${BANK_FAKE_AS_OF}`,
    note: "交通",
  },
  {
    block_key: "bank_prog_emergency" as const,
    title: "应急金",
    account_key: "ocbc_savings" as const,
    kind: "savings" as const,
    value: 2000,
    target: 10000,
    progress: 20,
    monthly_needed: 1000,
    due: "2027-12",
    status: "behind" as const,
    status_text: "落后约 2 个月",
    milestones: [
      { t: "2027-06", amount: 4000 },
      { t: "2027-09", amount: 7000 },
      { t: "2027-12", amount: 10000 },
    ],
    label: `截至 ${BANK_FAKE_AS_OF}`,
    note: "按月存入至年底",
  },
  {
    block_key: "bank_prog_gxs" as const,
    title: "GXS 储蓄",
    account_key: "gxs" as const,
    kind: "savings" as const,
    value: 1000,
    target: 2000,
    progress: 50,
    monthly_needed: 200,
    due: "2027-09",
    status: "ahead" as const,
    status_text: "提前 1 个月",
    milestones: [
      { t: "2027-06", amount: 1500 },
      { t: "2027-09", amount: 2000 },
    ],
    label: `截至 ${BANK_FAKE_AS_OF}`,
    note: "",
  },
  {
    block_key: "bank_prog_invest" as const,
    title: "Wise 外币额度",
    account_key: "wise" as const,
    kind: "room" as const,
    value: 0,
    target: 0,
    progress: 0,
    due: "2027-12",
    status: "no_target" as const,
    status_text: "未设定月额度",
    milestones: [],
    label: `截至 ${BANK_FAKE_AS_OF}`,
    note: "",
  },
];

export const BANK_FAKE_LIAB = [
  {
    title: "信用卡待还",
    kind: "card_statement" as const,
    amount: 7500,
    due: "2027-05-10",
    estimated: false,
    note: "",
  },
  {
    title: "税务预提",
    kind: "other" as const,
    amount: 2500,
    due: "2027-05-31",
    estimated: true,
    note: "FAKE",
  },
];

export const BANK_FAKE_TODOS = [
  {
    title: "补足总闸户至留存线（FAKE）",
    sub: "",
    due: "2027-05-05",
  },
  {
    title: "确认 5 月信用卡全额还清",
    sub: "",
    due: "2027-05-10",
  },
  {
    title: "为 Wise 设定外币额度",
    sub: "",
    due: "2027-05-15",
  },
];

export const BANK_FAKE_ALLOC = {
  month: "2027-04",
  title: "每月 25 日发薪后拨款（FAKE 规则） · 汇率口径：当日中间价（FAKE）",
  rows: [
    {
      account_key: "ocbc_savings" as const,
      label: "应急金",
      planned: 1000,
      actual: 1000,
      status: "done" as const,
    },
    {
      account_key: "hsbc" as const,
      label: "固定支出",
      planned: 2000,
      actual: 1000,
      status: "partial" as const,
    },
    {
      account_key: "trust" as const,
      label: "每日开销",
      planned: 500,
      actual: 700,
      status: "over" as const,
    },
    {
      account_key: "wise" as const,
      label: "外币",
      planned: 500,
      actual: 0,
      status: "pending" as const,
    },
  ],
};

const TREND_MONTHS_ACTUAL = [
  "2026-11",
  "2026-12",
  "2027-01",
  "2027-02",
  "2027-03",
  "2027-04",
];
const TREND_MONTHS_PROJ = [
  "2027-05",
  "2027-06",
  "2027-07",
  "2027-08",
  "2027-09",
  "2027-10",
];

export const BANK_FAKE_TRENDS = [
  {
    block_key: "bank_trend_ocbc_salary" as const,
    account_key: "ocbc_salary" as const,
    title: "OCBC 总闸户",
    actual: [3000, 2500, 2000, 1500, 1500, 1000],
    projected: [1500, 2000, 2000, 2000, 2000, 2000],
  },
  {
    block_key: "bank_trend_hsbc" as const,
    account_key: "hsbc" as const,
    title: "HSBC",
    actual: [0, 0, 500, 0, 0, 0],
    projected: [0, 0, 0, 0, 0, 0],
  },
  {
    block_key: "bank_trend_trust" as const,
    account_key: "trust" as const,
    title: "Trust",
    actual: [1000, 800, 700, 600, 500, 500],
    projected: [800, 800, 800, 800, 800, 800],
  },
  {
    block_key: "bank_trend_posb" as const,
    account_key: "posb" as const,
    title: "POSB",
    actual: [300, 300, 400, 300, 400, 500],
    projected: [500, 500, 500, 500, 500, 500],
  },
  {
    block_key: "bank_trend_ocbc_savings" as const,
    account_key: "ocbc_savings" as const,
    title: "OCBC 储蓄",
    actual: [0, 0, 500, 1000, 1500, 2000],
    projected: [3000, 4000, 5000, 6000, 7000, 8000],
  },
  {
    block_key: "bank_trend_gxs" as const,
    account_key: "gxs" as const,
    title: "GXS",
    actual: [0, 0, 0, 500, 500, 1000],
    projected: [1200, 1400, 1600, 1800, 2000, 2000],
  },
  {
    block_key: "bank_trend_wise" as const,
    account_key: "wise" as const,
    title: "Wise",
    actual: [] as number[],
    projected: [] as number[],
  },
];

export function bankFakeTrendSeries(actual: number[], projected: number[]) {
  return [
    ...actual.map((v, i) => ({
      t: TREND_MONTHS_ACTUAL[i]!,
      v,
      phase: "actual" as const,
      grain: "month" as const,
    })),
    ...projected.map((v, i) => ({
      t: TREND_MONTHS_PROJ[i]!,
      v,
      phase: "projected" as const,
      grain: "month" as const,
    })),
  ];
}

export const BANK_FAKE_LEDGER = [
  {
    month: "2027-04",
    in_total: 10500,
    out_total: 9500,
    lines: [
      { kind: "in" as const, category: "salary" as const, amount: 10000 },
      { kind: "in" as const, category: "other" as const, amount: 500 },
      { kind: "out" as const, category: "loan" as const, amount: 3000 },
      { kind: "out" as const, category: "card" as const, amount: 2500 },
      { kind: "out" as const, category: "support" as const, amount: 1000 },
      { kind: "out" as const, category: "food" as const, amount: 1200 },
      { kind: "out" as const, category: "transport" as const, amount: 300 },
      { kind: "out" as const, category: "subscription" as const, amount: 500 },
      { kind: "out" as const, category: "invest" as const, amount: 1000 },
    ],
  },
  {
    month: "2027-03",
    in_total: 10000,
    out_total: 9000,
    lines: [
      { kind: "in" as const, category: "salary" as const, amount: 10000 },
      { kind: "out" as const, category: "loan" as const, amount: 3000 },
      { kind: "out" as const, category: "card" as const, amount: 2000 },
      { kind: "out" as const, category: "support" as const, amount: 1000 },
      { kind: "out" as const, category: "food" as const, amount: 1000 },
      { kind: "out" as const, category: "tax" as const, amount: 1500 },
      { kind: "out" as const, category: "travel" as const, amount: 500 },
    ],
  },
  {
    month: "2027-02",
    in_total: 10000,
    out_total: 8500,
    lines: [
      { kind: "in" as const, category: "salary" as const, amount: 10000 },
      { kind: "out" as const, category: "loan" as const, amount: 3000 },
      { kind: "out" as const, category: "card" as const, amount: 2000 },
      { kind: "out" as const, category: "support" as const, amount: 1000 },
      { kind: "out" as const, category: "food" as const, amount: 1000 },
      { kind: "out" as const, category: "gift" as const, amount: 500 },
      { kind: "out" as const, category: "transport" as const, amount: 1000 },
    ],
  },
];

export const BANK_FAKE_ASSUMPTIONS = [
  "数据来自玄空告知与账本推算，非银行实时接口。",
  "内部转账不计收支。",
  "外币按当日中间价折算（FAKE）。",
].join("\n");
