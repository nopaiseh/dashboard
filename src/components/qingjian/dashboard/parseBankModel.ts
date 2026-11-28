/**
 * 从真实 dashboard section blocks 解析银行视图模型。
 * 按 payload.block_key 取块（白名单见 `@/lib/bank-block-keys`）；
 * 字段对齐 bank-validation.ts；不引用示例数字；缺字段 → 对应段为 null。
 */
import {
  BANK_ACCOUNT_KEYS,
  BANK_BLOCK_KEYS,
  BANK_GROUPS,
  type BankAccountKey,
  type BankBlockKey,
  type BankGroup,
} from "@/lib/bank-block-keys";
import { expectedBankBlockType } from "@/lib/dashboard/bank-validation";
import type {
  DashboardBlockPublic,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";
import {
  asBankNumber,
  isBankUnit,
  splitBankConclusionText,
} from "./bankFormat";
import {
  emptyBankViewModel,
  type BankAccountGroup,
  type BankAccountItem,
  type BankAllocData,
  type BankAllocItem,
  type BankConclusionData,
  type BankLedgerMonth,
  type BankLiabItem,
  type BankNetData,
  type BankProgressItem,
  type BankProgressKind,
  type BankProgressStatus,
  type BankTodoItem,
  type BankTrendSeries,
  type BankViewModel,
} from "./bankModel";
import { BANK_GROUP_LABELS } from "./bankTheme";
import { isSensitivePayloadKey } from "./format";

const KEY_SET = new Set<string>(BANK_BLOCK_KEYS);

type BankAccBlockKey = Extract<BankBlockKey, `bank_acc_${string}`>;
type BankTrendBlockKey = Extract<BankBlockKey, `bank_trend_${string}`>;

/** 户口 metric 槽位 → account_key；缺 key 时 typecheck 失败。 */
const ACC_KEY_BY_BLOCK = {
  bank_acc_ocbc_salary: "ocbc_salary",
  bank_acc_hsbc: "hsbc",
  bank_acc_trust: "trust",
  bank_acc_posb: "posb",
  bank_acc_ocbc_savings: "ocbc_savings",
  bank_acc_gxs: "gxs",
  bank_acc_wise: "wise",
} satisfies Record<BankAccBlockKey, BankAccountKey>;

/** 趋势 chart_series 槽位 → account_key；缺 key 时 typecheck 失败。 */
const TREND_KEY_BY_BLOCK = {
  bank_trend_ocbc_salary: "ocbc_salary",
  bank_trend_hsbc: "hsbc",
  bank_trend_trust: "trust",
  bank_trend_posb: "posb",
  bank_trend_ocbc_savings: "ocbc_savings",
  bank_trend_gxs: "gxs",
  bank_trend_wise: "wise",
} satisfies Record<BankTrendBlockKey, BankAccountKey>;

function clean(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (isSensitivePayloadKey(k)) continue;
    out[k] = v;
  }
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function payloadBlockKey(
  payload: Record<string, unknown>,
): BankBlockKey | undefined {
  const k = payload.block_key;
  if (typeof k !== "string") return undefined;
  return KEY_SET.has(k) ? (k as BankBlockKey) : undefined;
}

function findByKey(
  blocks: DashboardBlockPublic[],
  key: BankBlockKey,
): DashboardBlockPublic | undefined {
  const expected = expectedBankBlockType(key);
  return blocks.find((b) => {
    if (payloadBlockKey(clean(b.payload)) !== key) return false;
    return b.block_type === expected;
  });
}

function parseJsonItems<T>(
  items: unknown,
  map: (raw: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(items)) return [];
  const out: T[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    try {
      const parsed: unknown = JSON.parse(item);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        continue;
      }
      const mapped = map(parsed as Record<string, unknown>);
      if (mapped) out.push(mapped);
    } catch {
      /* skip bad item */
    }
  }
  return out;
}

function isBankGroup(v: unknown): v is BankGroup {
  return typeof v === "string" && (BANK_GROUPS as readonly string[]).includes(v);
}

function isAccountKey(v: unknown): v is BankAccountKey {
  return (
    typeof v === "string" &&
    (BANK_ACCOUNT_KEYS as readonly string[]).includes(v)
  );
}

function parseConclusion(
  blocks: DashboardBlockPublic[],
): BankConclusionData | null {
  const b = findByKey(blocks, "bank_conclusion");
  if (!b) return null;
  const p = clean(b.payload);
  const title = str(p.title)?.trim() || str(p.text)?.trim() || "";
  if (!title && !str(p.text)?.trim()) return null;
  const rawText = str(p.text)?.trim() ?? "";
  // title 优先作标题；若 title 缺省则整段 text 当标题、无 body
  if (str(p.title)?.trim()) {
    const { body, urgent } = splitBankConclusionText(rawText);
    return { title: str(p.title)!.trim(), body, urgent };
  }
  const { body, urgent } = splitBankConclusionText(rawText);
  return { title: body || rawText, body: "", urgent };
}

function parseNet(blocks: DashboardBlockPublic[]): BankNetData | null {
  const b = findByKey(blocks, "bank_net");
  if (!b) return null;
  const p = clean(b.payload);
  const net = asBankNumber(p.value);
  const cashTotal = asBankNumber(p.cash_total);
  const liabTotal = asBankNumber(p.liab_total);
  if (net === null || cashTotal === null || liabTotal === null) return null;
  return {
    net,
    cashTotal,
    liabTotal,
    label: str(p.label)?.trim() ?? "",
  };
}

function parseProgressItem(
  key: BankBlockKey,
  blocks: DashboardBlockPublic[],
): BankProgressItem | null {
  const b = findByKey(blocks, key);
  if (!b) return null;
  const p = clean(b.payload);
  const accountKey = p.account_key;
  if (!isAccountKey(accountKey)) return null;
  const value = asBankNumber(p.value);
  const target = asBankNumber(p.target);
  const progress = asBankNumber(p.progress);
  if (value === null || target === null || progress === null) return null;
  const kind = str(p.kind) as BankProgressKind | undefined;
  const status = str(p.status) as BankProgressStatus | undefined;
  if (
    !kind ||
    !["savings", "floor", "budget", "streak", "room"].includes(kind)
  ) {
    return null;
  }
  if (
    !status ||
    !["on_track", "ahead", "behind", "no_target"].includes(status)
  ) {
    return null;
  }
  const due = str(p.due)?.trim();
  if (!due) return null;
  const title = str(p.title)?.trim();
  if (!title) return null;

  const milestonesRaw = Array.isArray(p.milestones) ? p.milestones : [];
  const milestones = milestonesRaw.flatMap((m) => {
    if (typeof m !== "object" || m === null) return [];
    const row = m as Record<string, unknown>;
    const t = str(row.t)?.trim();
    const amount = asBankNumber(row.amount);
    if (!t || amount === null) return [];
    return [{ t, amount }];
  });

  const monthlyNeeded = asBankNumber(p.monthly_needed) ?? undefined;
  // 优先读 payload.unit：白名单内规范化；白名单外原样保留（展示层数字兜底）；
  // 缺省时 streak →「月」，其余 → S$（与 BANK_UNITS 一致）
  const rawUnit = str(p.unit)?.trim();
  const unit = isBankUnit(rawUnit)
    ? rawUnit
    : rawUnit
      ? rawUnit
      : kind === "streak"
        ? ("月" as const)
        : ("S$" as const);

  return {
    key,
    title,
    accountKey,
    kind,
    value,
    target,
    unit,
    progress,
    monthlyNeeded,
    due,
    status,
    statusText: str(p.status_text)?.trim() ?? "",
    milestones,
    label: str(p.label)?.trim() ?? "",
    note: str(p.note)?.trim() ?? "",
  };
}

const PROG_KEYS = BANK_BLOCK_KEYS.filter((k) =>
  k.startsWith("bank_prog_"),
) as BankBlockKey[];

function parseAllProgress(blocks: DashboardBlockPublic[]): BankProgressItem[] {
  const items: BankProgressItem[] = [];
  for (const key of PROG_KEYS) {
    const item = parseProgressItem(key, blocks);
    if (item) items.push(item);
  }
  return items;
}

function parseAccount(
  blockKey: BankBlockKey,
  accountKey: BankAccountKey,
  blocks: DashboardBlockPublic[],
  progressByAccount: Map<BankAccountKey, BankProgressItem>,
): BankAccountItem | null {
  const b = findByKey(blocks, blockKey);
  if (!b) return null;
  const p = clean(b.payload);
  const name = str(p.title)?.trim() || accountKey;
  const roleTag = str(p.role_tag)?.trim() ?? "";
  const group = isBankGroup(p.group)
    ? p.group
    : defaultGroupForAccount(accountKey);
  // 非 number / 非有限 → 暂无数据（夹具可省略 value；生产写入仍要求 number）
  const value = asBankNumber(p.value);
  const label = str(p.label)?.trim() ?? "";

  const item: BankAccountItem = {
    accountKey,
    name,
    roleTag,
    group,
    value,
    asOf: label,
    progress: progressByAccount.get(accountKey) ?? null,
  };

  // delta_mom / ytd：字段缺失 → undefined（显示 —）；显式 number（含 0）保留
  if ("delta_mom" in p) {
    const d = asBankNumber(p.delta_mom);
    if (d !== null) item.deltaMom = d;
  }
  if ("ytd" in p) {
    const y = asBankNumber(p.ytd);
    if (y !== null) item.ytd = y;
  }

  return item;
}

function defaultGroupForAccount(key: BankAccountKey): BankGroup {
  switch (key) {
    case "ocbc_salary":
      return "hub";
    case "hsbc":
      return "fixed";
    case "trust":
    case "posb":
      return "daily";
    case "ocbc_savings":
    case "gxs":
      return "savings";
    case "wise":
      return "fx";
  }
}

function parseGroups(
  blocks: DashboardBlockPublic[],
  progress: BankProgressItem[],
): { groups: BankAccountGroup[]; asOf: string } {
  const progressByAccount = new Map<BankAccountKey, BankProgressItem>();
  for (const p of progress) {
    if (!progressByAccount.has(p.accountKey)) {
      progressByAccount.set(p.accountKey, p);
    }
  }

  const accounts: BankAccountItem[] = [];
  for (const [blockKey, accountKey] of Object.entries(ACC_KEY_BY_BLOCK) as Array<
    [BankBlockKey, BankAccountKey]
  >) {
    const acc = parseAccount(blockKey, accountKey, blocks, progressByAccount);
    if (acc) accounts.push(acc);
  }

  let asOf = "";
  for (const a of accounts) {
    if (a.asOf) {
      asOf = a.asOf;
      break;
    }
  }

  const groups: BankAccountGroup[] = BANK_GROUPS.map((id) => {
    const rows = accounts.filter((a) => a.group === id);
    const nums = rows
      .map((r) => r.value)
      .filter((v): v is number => v !== null);
    const subtotal = nums.length === 0 ? null : nums.reduce((s, n) => s + n, 0);
    return {
      id,
      label: BANK_GROUP_LABELS[id],
      subtotal,
      accounts: rows,
    };
  }).filter((g) => g.accounts.length > 0);

  return { groups, asOf };
}

function parseLiab(blocks: DashboardBlockPublic[]): BankLiabItem[] | null {
  const b = findByKey(blocks, "bank_liab");
  if (!b) return null;
  const p = clean(b.payload);
  const items = parseJsonItems(p.items, (raw) => {
    const title = str(raw.title)?.trim();
    const amount = asBankNumber(raw.amount);
    const due = str(raw.due)?.trim();
    const kind = str(raw.kind);
    if (!title || amount === null || !due) return null;
    if (
      kind !== "card_statement" &&
      kind !== "grab_ledger" &&
      kind !== "other"
    ) {
      return null;
    }
    const item: BankLiabItem = {
      title,
      kind,
      amount,
      due,
      estimated: bool(raw.estimated) === true,
      note: str(raw.note)?.trim() ?? "",
    };
    return item;
  });
  return items;
}

function parseTodos(blocks: DashboardBlockPublic[]): BankTodoItem[] | null {
  const b = findByKey(blocks, "bank_todos");
  if (!b) return null;
  const p = clean(b.payload);
  return parseJsonItems(p.items, (raw) => {
    const title = str(raw.title)?.trim();
    const due = str(raw.due)?.trim();
    if (!title || !due) return null;
    return {
      title,
      sub: str(raw.sub)?.trim() ?? "",
      due,
      overdue: bool(raw.overdue),
      info: bool(raw.info),
      irreversible: bool(raw.irreversible),
    };
  });
}

function parseAlloc(blocks: DashboardBlockPublic[]): BankAllocData | null {
  const b = findByKey(blocks, "bank_alloc");
  if (!b) return null;
  const p = clean(b.payload);
  const month = str(p.month)?.trim();
  if (!month) return null;
  const rows: BankAllocItem[] = parseJsonItems(p.items, (raw) => {
    const accountKey = raw.account_key;
    if (!isAccountKey(accountKey)) return null;
    const label = str(raw.label)?.trim();
    const planned = asBankNumber(raw.planned);
    const status = str(raw.status);
    if (!label || planned === null) return null;
    if (
      status !== "pending" &&
      status !== "partial" &&
      status !== "done" &&
      status !== "over"
    ) {
      return null;
    }
    const item: BankAllocItem = {
      accountKey,
      label,
      planned,
      status,
    };
    if ("actual" in raw) {
      const a = asBankNumber(raw.actual);
      if (a !== null) item.actual = a;
    }
    return item;
  });
  return {
    month,
    title: str(p.title)?.trim() ?? "",
    rows,
  };
}

function parseTrends(blocks: DashboardBlockPublic[]): BankTrendSeries[] {
  const out: BankTrendSeries[] = [];
  for (const [blockKey, accountKey] of Object.entries(TREND_KEY_BY_BLOCK) as Array<
    [BankBlockKey, BankAccountKey]
  >) {
    const b = findByKey(blocks, blockKey);
    if (!b) continue;
    const p = clean(b.payload);
    const title = str(p.title)?.trim() || accountKey;
    const series = Array.isArray(p.series) ? p.series : [];
    const points = series
      .flatMap((pt) => {
        if (typeof pt !== "object" || pt === null) return [];
        const row = pt as Record<string, unknown>;
        const t = str(row.t)?.trim();
        const v = asBankNumber(row.v);
        const phase = str(row.phase);
        if (!t || v === null) return [];
        if (phase !== "actual" && phase !== "projected") return [];
        return [{ t, v, phase: phase as "actual" | "projected" }];
      })
      // 服务端不保证顺序；画图前按月份升序
      .sort((a, b) => a.t.localeCompare(b.t));
    const range = str(p.range_default);
    out.push({
      accountKey,
      title,
      points,
      defaultRange: range === "all" ? "all" : "12m",
    });
  }
  return out;
}

/**
 * 解析器会按 block_key 查找的白名单槽位（应与 BANK_BLOCK_KEYS 一致）。
 * 供测试断言 #35 的 28 个 key 均被前端覆盖。
 */
export function bankParserCoveredBlockKeys(): BankBlockKey[] {
  const keys = new Set<BankBlockKey>([
    "bank_conclusion",
    "bank_net",
    "bank_liab",
    "bank_todos",
    "bank_alloc",
    "bank_ledger",
    "bank_assumptions",
    ...(Object.keys(ACC_KEY_BY_BLOCK) as BankBlockKey[]),
    ...PROG_KEYS,
    ...(Object.keys(TREND_KEY_BY_BLOCK) as BankBlockKey[]),
  ]);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function parseLedger(
  blocks: DashboardBlockPublic[],
): BankLedgerMonth[] | null {
  const b = findByKey(blocks, "bank_ledger");
  if (!b) return null;
  const p = clean(b.payload);
  return parseJsonItems(p.items, (raw) => {
    const month = str(raw.month)?.trim();
    const inTotal = asBankNumber(raw.in_total);
    const outTotal = asBankNumber(raw.out_total);
    if (!month || inTotal === null || outTotal === null) return null;
    const linesRaw = Array.isArray(raw.lines) ? raw.lines : [];
    const lines = linesRaw.flatMap((line) => {
      if (typeof line !== "object" || line === null) return [];
      const row = line as Record<string, unknown>;
      const kind = str(row.kind);
      const category = str(row.category)?.trim();
      const amount = asBankNumber(row.amount);
      if ((kind !== "in" && kind !== "out") || !category || amount === null) {
        return [];
      }
      return [{ kind: kind as "in" | "out", category, amount }];
    });
    return { month, inTotal, outTotal, lines };
  });
}

function parseAssumptions(
  blocks: DashboardBlockPublic[],
): string[] | null {
  const b = findByKey(blocks, "bank_assumptions");
  if (!b) return null;
  const p = clean(b.payload);
  const text = str(p.text)?.trim();
  if (!text) return null;
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** 仅根据 API 分区数据组装；字段名对齐 bank-validation.ts。 */
export function parseBankModel(
  section: DashboardSectionPublic,
): BankViewModel {
  const model = emptyBankViewModel();
  const blocks = section.blocks;
  model.conclusion = parseConclusion(blocks);
  model.net = parseNet(blocks);
  model.progress = parseAllProgress(blocks);
  const { groups, asOf } = parseGroups(blocks, model.progress);
  model.groups = groups;
  model.asOf = asOf || model.net?.label || "";
  model.liab = parseLiab(blocks);
  model.todos = parseTodos(blocks);
  model.alloc = parseAlloc(blocks);
  model.trends = parseTrends(blocks);
  model.ledger = parseLedger(blocks);
  model.assumptions = parseAssumptions(blocks);
  return model;
}
