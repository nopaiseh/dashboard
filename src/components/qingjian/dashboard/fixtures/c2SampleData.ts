/**
 * C2 定稿示例数据（源自 /cursor/stores/bot/xuanji-cpf-c2/c2_model.py）。
 * 全部为虚构示例，不得当作真实 CPF 数据。
 */

export const C2_COLORS = {
  oa: "#a9c9b6",
  sa: "#2d5a47",
  ma: "#dcb77f",
} as const;

export const C2_TARGETS = {
  BHS: 75_000,
  BRS: 110_000,
  FRS: 220_000,
  ERS: 440_000,
} as const;

export const C2_RATES = { OA: 0.025, SA: 0.04, MA: 0.04 } as const;

export const C2_CONTRIB = {
  OA: 1840,
  SA: 480,
  MA: 640,
  employer: 1360,
  self: 1600,
  total: 2960,
  annualLimit: 35_520,
  paidYtd: 29_600,
  limitLeft: 5_920,
  asOfMonth: "2026 年 10 月",
  note: "缴存按入账月计：2026 年 10 月入账的是 9 月工资；示例月薪 S$ 8,000，上限为示例值。",
} as const;

export type AccBalances = { OA: number; SA: number; MA: number };

export const C2_BAL: AccBalances = {
  OA: 205_181,
  SA: 57_781,
  MA: 72_613,
};

export const C2_CHG_M: AccBalances = { OA: 1840, SA: 480, MA: 640 };
export const C2_CHG_Y: AccBalances = { OA: 18_400, SA: 4_800, MA: 5_900 };

export const C2_INT_JAN: AccBalances = {
  OA: 4_556,
  SA: 2_615,
  MA: 2_566,
};
export const C2_INT_TOTAL = 9_737;

export const C2_YEAR_END: Record<number, AccBalances> = {
  2016: { OA: 5968, SA: 1557, MA: 1955 },
  2017: { OA: 16560, SA: 4438, MA: 5536 },
  2018: { OA: 28909, SA: 7995, MA: 9768 },
  2019: { OA: 43059, SA: 12196, MA: 14679 },
  2020: { OA: 59054, SA: 17045, MA: 20095 },
  2021: { OA: 82541, SA: 22579, MA: 26227 },
  2022: { OA: 111762, SA: 28558, MA: 38843 },
  2023: { OA: 133205, SA: 35165, MA: 46463 },
  2024: { OA: 156676, SA: 42426, MA: 54887 },
  2025: { OA: 182225, SA: 50366, MA: 64147 },
};

/** 近 12 个月月底余额：2025-11 … 2026-10 */
export const C2_MONTHS: Array<{ t: string; balances: AccBalances }> = [
  { t: "2025-11", balances: { OA: 180422, SA: 49896, MA: 63520 } },
  { t: "2025-12", balances: { OA: 182225, SA: 50366, MA: 64147 } },
  { t: "2026-01", balances: { OA: 188621, SA: 53461, MA: 67353 } },
  { t: "2026-02", balances: { OA: 190461, SA: 53941, MA: 67993 } },
  { t: "2026-03", balances: { OA: 192301, SA: 54421, MA: 68633 } },
  { t: "2026-04", balances: { OA: 194141, SA: 54901, MA: 69273 } },
  { t: "2026-05", balances: { OA: 195981, SA: 55381, MA: 69913 } },
  { t: "2026-06", balances: { OA: 197821, SA: 55861, MA: 70553 } },
  { t: "2026-07", balances: { OA: 199661, SA: 56341, MA: 70933 } },
  { t: "2026-08", balances: { OA: 201501, SA: 56821, MA: 71333 } },
  { t: "2026-09", balances: { OA: 203341, SA: 57301, MA: 71973 } },
  { t: "2026-10", balances: { OA: 205181, SA: 57781, MA: 72613 } },
];

/** 推算（来自 c2_model.project；近月逐月，其后半年抽样至 ERS） */
export const C2_PROJ: Array<{ t: string; balances: AccBalances }> = [
  { t: "2026-11", balances: { OA: 207448, SA: 58504, MA: 73495 } },
  { t: "2026-12", balances: { OA: 209721, SA: 59229, MA: 74380 } },
  { t: "2027-01", balances: { OA: 211998, SA: 60224, MA: 75000 } },
  { t: "2027-02", balances: { OA: 214279, SA: 61845, MA: 75000 } },
  { t: "2027-03", balances: { OA: 216566, SA: 63471, MA: 75000 } },
  { t: "2027-04", balances: { OA: 218857, SA: 65102, MA: 75000 } },
  { t: "2027-05", balances: { OA: 221153, SA: 66739, MA: 75000 } },
  { t: "2027-06", balances: { OA: 223454, SA: 68382, MA: 75000 } },
  { t: "2027-07", balances: { OA: 225759, SA: 69770, MA: 75000 } },
  { t: "2028-01", balances: { OA: 239693, SA: 79524, MA: 75000 } },
  { t: "2028-07", balances: { OA: 253803, SA: 89459, MA: 75000 } },
  { t: "2029-01", balances: { OA: 268090, SA: 99611, MA: 75000 } },
  { t: "2029-07", balances: { OA: 282556, SA: 109951, MA: 75000 } },
  { t: "2030-01", balances: { OA: 297204, SA: 120516, MA: 75000 } },
  { t: "2030-07", balances: { OA: 312036, SA: 131278, MA: 75000 } },
];

export const C2_HIT = {
  BHS: "2027 年 1 月",
  ERS: "2030 年 7 月",
  BRS: "2022 年",
  FRS: "2025 年",
} as const;

export const C2_EXCEED_FRS = 42_962;
export const C2_OA_SA = 262_962;
export const C2_TOTAL = 335_575;
export const C2_AS_OF = "2026-10-31";

export const C2_TRANSFERS = [
  {
    t: "2021-12",
    year: 2021,
    label: "Edusave / PSEA",
    short: "Edusave / PSEA → OA",
    text: "一次性转入 · Edusave / PSEA → OA S$ 5,600（示例）",
  },
  {
    t: "2022-12",
    year: 2022,
    label: "NS Home Awards",
    short: "NS Home Awards → OA、MA",
    text: "一次性转入 · NS Home Awards → OA S$ 10,000、MA S$ 6,000（示例）",
  },
] as const;

export const C2_EMPLOYER_CHANGES = [
  { t: "2021-05", label: "换雇主" },
  { t: "2023-08", label: "换雇主" },
] as const;

export const C2_CONCLUSION = {
  title: `SA+OA 已达 FRS，超出 S$ ${C2_EXCEED_FRS.toLocaleString("en-SG")}；下一档 ERS 预计 ${C2_HIT.ERS}。`,
  body: `SA+OA 已达 FRS，超出部分与下一档 ERS 的估算按每月缴存 S$ 2,960（示例）与现行利率、按月复利推算，未计入利率调整、工资变动和政策变化。MA 已达 BHS 的 97%。数据截至结算单 ${C2_AS_OF}。`,
  reachedFrs: true,
};

export type C2Todo = {
  title: string;
  sub: string;
  due: string;
  overdue?: boolean;
  info?: boolean;
  irreversible?: boolean;
};

export const C2_TODOS: C2Todo[] = [
  {
    title: "核对 10 月工资的公积金入账",
    sub: "10 月工资的公积金，次月 14 号前入账；已过 11-14，结算单里还没看到",
    due: "已过 11-14 · 待核对",
    overdue: true,
  },
  {
    title: "每月 1 号：自己查看 CPF，把结算单发给姐妹",
    sub: "下次 12-01；数据每月更新一次",
    due: "12-01",
  },
  {
    title: "RSTU 12-31 截止，关系到当年税务减免",
    sub: "本年尚未填补。应急金和信用卡还清优先",
    due: "12-31",
  },
  {
    title: "1 月核对利息入账，并更新年度目标（BHS、BRS/FRS/ERS）",
    sub: "新目标值 1 月生效",
    due: "2027-01",
  },
  {
    title: "3–4 月核对年度结算单（全年数字）",
    sub: "对照全年缴存与利息",
    due: "3–4 月",
  },
  {
    title: "MA 接近 BHS：之后 MA 的缴存会溢到 SA",
    sub: "MA 已达 BHS 97%，估算 2027 年 1 月达到；55 岁后改溢到 OA",
    due: "提示",
    info: true,
  },
  {
    title: "OA 转 SA（不可逆，需玄空哥决定）",
    sub: "转出后不能转回；仅供你考虑，不会自动执行。专户利率更高，有助于下一档 ERS。",
    due: "待你定",
    irreversible: true,
  },
];

export const C2_LEDGER = [
  {
    date: "2026-10-10",
    kind: "in" as const,
    typeLabel: "＋ 缴存",
    note: "9 月工资的公积金（雇主 + 本人）",
    OA: 1840,
    SA: 480,
    MA: 640,
    total: 2960,
  },
  {
    date: "2026-09-11",
    kind: "in" as const,
    typeLabel: "＋ 缴存",
    note: "8 月工资的公积金（雇主 + 本人）",
    OA: 1840,
    SA: 480,
    MA: 640,
    total: 2960,
  },
  {
    date: "2026-08-18",
    kind: "fee" as const,
    typeLabel: "－ 保险扣款",
    note: "CareShield Life 保费（示例）",
    OA: null,
    SA: null,
    MA: -240,
    total: -240,
  },
  {
    date: "2026-08-12",
    kind: "in" as const,
    typeLabel: "＋ 缴存",
    note: "7 月工资的公积金（雇主 + 本人）",
    OA: 1840,
    SA: 480,
    MA: 640,
    total: 2960,
  },
  {
    date: "2026-07-20",
    kind: "fee" as const,
    typeLabel: "－ 保险扣款",
    note: "MediShield Life 保费（示例）",
    OA: null,
    SA: null,
    MA: -260,
    total: -260,
  },
  {
    date: "2026-07-10",
    kind: "in" as const,
    typeLabel: "＋ 缴存",
    note: "6 月工资的公积金（雇主 + 本人）",
    OA: 1840,
    SA: 480,
    MA: 640,
    total: 2960,
  },
] as const;

export const C2_ASSUMPTIONS = {
  contribLine: "S$ 2,960",
  contribDetail: "OA 1,840 · SA 480 · MA 640",
  rateLine: "OA 约 2.5% · SA、MA 约 4%",
  rateExtra: "头 S$ 60,000 额外 1%",
  bullets: [
    "按现行利率计息，未计入利率调整、工资变动、提取和政策变化；达标年月仅供规划参考。",
    "「每月缴存」是进账的本金；「余额月增长」= 缴存 + 利息 − 扣款，利息每年 1 月一次入账，所以实线在 1 月有台阶，估算虚线按月平滑计算。",
    "MA 超出 BHS 的部分会自动转入 SA（55 岁后转入 OA），估算已按此处理。",
    "BHS、BRS、FRS、ERS 是年度目标，每年 1 月更新；本稿用示例值，不随年度上调。已超过的档位按实际比例显示，不卡在 100%。",
    "走势图可在「近 12 个月」与「全部（2016 年起）」之间切换。全部视图里，2016–2025 按年底数、2026 年起按月底数；若某年没有结算单，该段会用浅灰斜纹标出并注明「该年暂无结算单」。",
    `数据截至结算单 ${C2_AS_OF}，每月更新一次；页面不显示身份证号或 CPF 户口号码。`,
  ],
  byline: `写入者：财务姐妹（示例）· 数据截至结算单 ${C2_AS_OF}`,
} as const;
