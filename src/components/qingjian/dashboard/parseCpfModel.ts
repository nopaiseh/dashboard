/**
 * 从真实 dashboard section blocks 解析 C2 视图模型。
 * 优先按 payload.block_key 取块（白名单见 `@/lib/cpf-block-keys`）；
 * 无对应 key 时再按标题回退（跳过已带 block_key 的块）。
 * 字段名对齐 PR #24 validation schema；不引用示例数字；缺字段 → 对应段为 null。
 */
import {
  CPF_BLOCK_KEYS,
  type CpfBlockKey,
} from "@/lib/cpf-block-keys";
import type {
  DashboardBlockPublic,
  DashboardSectionPublic,
} from "@/lib/dashboard/types";
import { isSensitivePayloadKey } from "./format";
import {
  emptyCpfViewModel,
  type AccBalances,
  type AccKey,
  type CpfAnnualData,
  type CpfAssumptionsData,
  type CpfAccountsData,
  type CpfConclusionData,
  type CpfContribData,
  type CpfLedgerRow,
  type CpfProgressData,
  type CpfTodoItem,
  type CpfTrendData,
  type CpfTrendEvent,
  type CpfTrendPoint,
  type CpfViewModel,
} from "./cpfModel";

/** 默认退休档顺序（无 tiers 时回退）：BRS < FRS < ERS。 */
const DEFAULT_RETIREMENT_TIER_ORDER = ["BRS", "FRS", "ERS"] as const;

const KEY_SET = new Set<string>(CPF_BLOCK_KEYS);

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

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function payloadBlockKey(
  payload: Record<string, unknown>,
): CpfBlockKey | undefined {
  const k = payload.block_key;
  if (typeof k !== "string") return undefined;
  return KEY_SET.has(k) ? (k as CpfBlockKey) : undefined;
}

function findByKey(
  blocks: DashboardBlockPublic[],
  key: CpfBlockKey,
): DashboardBlockPublic | undefined {
  return blocks.find((b) => payloadBlockKey(clean(b.payload)) === key);
}

/** 标题回退候选：跳过已带 block_key 的块，避免误匹配其他槽位。 */
function unkeyed(blocks: DashboardBlockPublic[]): DashboardBlockPublic[] {
  return blocks.filter((b) => payloadBlockKey(clean(b.payload)) === undefined);
}

function blocksOfType(
  blocks: DashboardBlockPublic[],
  type: DashboardBlockPublic["block_type"],
): DashboardBlockPublic[] {
  return blocks.filter((b) => b.block_type === type);
}

function titleOf(b: DashboardBlockPublic): string {
  return str(clean(b.payload).title)?.trim() ?? "";
}

function matchTitle(title: string, ...needles: string[]): boolean {
  const t = title.toLowerCase();
  return needles.some((n) => t.includes(n.toLowerCase()));
}

/**
 * 由 progress.`reached_tier` 判断是否已达 FRS（含更高档如 ERS）。
 * 大小写规范化后，与该块 `tiers[].key` 比较档位高低（按 tiers 数组顺序；
 * 若带 amount 则按 amount 升序覆盖顺序）。未知档 / 空值 → 未达。
 */
export function reachedFrsFromTier(
  reachedTier: string | undefined,
  tiers?: Array<{ key: string; amount?: number }>,
): boolean {
  const key = reachedTier?.trim().toUpperCase();
  if (!key) return false;

  const orderedKeys = orderedTierKeys(tiers);
  const frsIdx = orderedKeys.indexOf("FRS");
  if (frsIdx < 0) return false;
  const reachedIdx = orderedKeys.indexOf(key);
  if (reachedIdx < 0) return false;
  return reachedIdx >= frsIdx;
}

function orderedTierKeys(
  tiers?: Array<{ key: string; amount?: number }>,
): string[] {
  if (!tiers || tiers.length === 0) {
    return [...DEFAULT_RETIREMENT_TIER_ORDER];
  }
  const normalized = tiers
    .map((t) => ({
      key: t.key.trim().toUpperCase(),
      amount: typeof t.amount === "number" && Number.isFinite(t.amount)
        ? t.amount
        : undefined,
    }))
    .filter((t) => t.key.length > 0);
  if (normalized.length === 0) return [...DEFAULT_RETIREMENT_TIER_ORDER];

  const allHaveAmount = normalized.every((t) => t.amount !== undefined);
  if (allHaveAmount) {
    return [...normalized]
      .sort((a, b) => (a.amount as number) - (b.amount as number))
      .map((t) => t.key);
  }
  return normalized.map((t) => t.key);
}

function parseConclusion(
  blocks: DashboardBlockPublic[],
  pageHeadline: string,
  reachedFrs: boolean,
): CpfConclusionData | null {
  const keyed = findByKey(blocks, "cpf_conclusion");
  if (keyed) {
    const p = clean(keyed.payload);
    let title = "";
    let body = "";
    if (keyed.block_type === "headline") {
      title = str(p.text)?.trim() ?? "";
    } else {
      title = str(p.title)?.trim() || str(p.text)?.trim() || "";
      body = str(p.title)?.trim() ? (str(p.text)?.trim() ?? "") : "";
      if (!str(p.title)?.trim() && str(p.text)?.trim()) {
        title = str(p.text)!.trim();
        body = "";
      }
    }
    if (!title) title = pageHeadline.trim();
    if (!title) return null;
    return { title, body, reachedFrs };
  }

  const headlines = unkeyed(blocksOfType(blocks, "headline"));
  const texts = unkeyed(blocksOfType(blocks, "text")).filter(
    (b) =>
      !matchTitle(titleOf(b), "估算说明", "RSTU", "本月缴存", "利息"),
  );

  let title = "";
  let body = "";

  if (headlines[0]) {
    title = str(clean(headlines[0].payload).text)?.trim() ?? "";
  }
  if (!title && texts[0]) {
    const p = clean(texts[0].payload);
    title = str(p.title)?.trim() || pageHeadline.trim();
    body = str(p.text)?.trim() ?? "";
  }
  if (!title) title = pageHeadline.trim();
  if (!title && !body) return null;
  if (!title) return null;
  return { title, body, reachedFrs };
}

function parseAccounts(blocks: DashboardBlockPublic[]): CpfAccountsData | null {
  const metrics = blocksOfType(blocks, "metric");
  if (metrics.length === 0 && !findByKey(blocks, "cpf_acc_oa")) return null;

  const pickUnkeyed = (...needles: string[]) =>
    unkeyed(metrics).find((b) => {
      const t = titleOf(b);
      // 利息块标题常含 OA/SA/MA，不得当作户口余额。
      if (t.includes("利息")) return false;
      return matchTitle(t, ...needles);
    });

  const oa =
    findByKey(blocks, "cpf_acc_oa") ??
    pickUnkeyed("普通户口", " OA", "OA");
  const sa =
    findByKey(blocks, "cpf_acc_sa") ??
    pickUnkeyed("特别户口", " SA", "SA");
  const ma =
    findByKey(blocks, "cpf_acc_ma") ??
    pickUnkeyed("保健储蓄", " MA", "MA");

  const readAcc = (
    b: DashboardBlockPublic | undefined,
  ): { value: number; mom: number; ytd: number } | null => {
    if (!b) return null;
    const p = clean(b.payload);
    const value = num(p.value);
    if (value === undefined) return null;
    return {
      value,
      mom: num(p.delta_mom) ?? 0,
      ytd: num(p.ytd) ?? 0,
    };
  };

  const oaA = readAcc(oa);
  const saA = readAcc(sa);
  const maA = readAcc(ma);
  if (!oaA || !saA || !maA) return null;

  const balances: AccBalances = {
    OA: oaA.value,
    SA: saA.value,
    MA: maA.value,
  };
  const chgM: AccBalances = { OA: oaA.mom, SA: saA.mom, MA: maA.mom };
  const chgY: AccBalances = { OA: oaA.ytd, SA: saA.ytd, MA: maA.ytd };

  const asOf =
    str(clean(oa?.payload ?? {}).label)?.trim() ||
    str(clean(sa?.payload ?? {}).label)?.trim() ||
    str(clean(ma?.payload ?? {}).label)?.trim() ||
    "";

  // 本月缴存合计来自 cpf_contrib，不在此读 acc_total / 合计 metric。
  return {
    balances,
    chgM,
    chgY,
    asOf,
    monthContribTotal: undefined,
    monthInterest: undefined,
  };
}

function tierAmount(
  tiers: Array<{ key: string; amount: number }>,
  key: string,
): number | undefined {
  return tiers.find((t) => t.key.toUpperCase() === key.toUpperCase())?.amount;
}

function parseTiers(
  raw: unknown,
): Array<{ key: string; label: string; amount: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ key: string; label: string; amount: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const key = str(r.key)?.trim();
    const label = str(r.label)?.trim() ?? key;
    const amount = num(r.amount);
    if (!key || !label || amount === undefined) continue;
    out.push({ key, label, amount });
  }
  return out;
}

function parseProgress(blocks: DashboardBlockPublic[]): {
  data: CpfProgressData | null;
  reachedFrs: boolean;
} {
  const progresses = blocksOfType(blocks, "progress");
  const maBlk =
    findByKey(blocks, "cpf_prog_ma") ??
    unkeyed(progresses).find((b) =>
      matchTitle(titleOf(b), "MA", "BHS", "保健"),
    );
  const oaSaBlk =
    findByKey(blocks, "cpf_prog_oasa") ??
    unkeyed(progresses).find((b) =>
      matchTitle(titleOf(b), "SA+OA", "BRS", "FRS", "ERS", "退休"),
    ) ??
    unkeyed(progresses).find((b) => b !== maBlk);

  if (progresses.length === 0 && !maBlk && !oaSaBlk) {
    return { data: null, reachedFrs: false };
  }

  let reachedFrs = false;
  for (const b of [oaSaBlk, maBlk].filter(Boolean) as DashboardBlockPublic[]) {
    const p = clean(b.payload);
    const rt = str(p.reached_tier);
    const blockTiers = parseTiers(p.tiers);
    if (reachedFrsFromTier(rt, blockTiers)) reachedFrs = true;
  }
  // Also scan other progress blocks for reached_tier (keyed or not).
  for (const b of progresses) {
    if (b === oaSaBlk || b === maBlk) continue;
    const p = clean(b.payload);
    const rt = str(p.reached_tier);
    const blockTiers = parseTiers(p.tiers);
    if (reachedFrsFromTier(rt, blockTiers)) reachedFrs = true;
  }

  if (!oaSaBlk && !maBlk) return { data: null, reachedFrs };

  const oaSaP = oaSaBlk ? clean(oaSaBlk.payload) : null;
  const maP = maBlk ? clean(maBlk.payload) : null;
  const oaSaTiers = parseTiers(oaSaP?.tiers);
  const maTiers = parseTiers(maP?.tiers);

  const brs = tierAmount(oaSaTiers, "BRS");
  const frs = tierAmount(oaSaTiers, "FRS");
  const ers = tierAmount(oaSaTiers, "ERS");
  const bhs = tierAmount(maTiers, "BHS") ?? tierAmount(oaSaTiers, "BHS");
  const oaSa = num(oaSaP?.value);
  const ma = num(maP?.value);

  if (
    oaSa === undefined ||
    ma === undefined ||
    bhs === undefined ||
    brs === undefined ||
    frs === undefined ||
    ers === undefined
  ) {
    return { data: null, reachedFrs };
  }

  const exceedFrs = num(oaSaP?.overshoot) ?? Math.max(0, oaSa - frs);
  const nextYear = num(oaSaP?.next_tier_year);
  const maNextYear = num(maP?.next_tier_year);
  const ersStatus = str(oaSaP?.status)?.trim();
  const bhsStatus = str(maP?.status)?.trim();
  const reachedTier = str(oaSaP?.reached_tier)?.trim().toUpperCase() || undefined;

  return {
    reachedFrs,
    data: {
      ma,
      bhs,
      oaSa,
      brs,
      frs,
      ers,
      exceedFrs,
      reachedTier,
      nextEstimate: formatHitLabel(ersStatus, nextYear),
      hitBhs: formatHitLabel(bhsStatus, maNextYear),
    },
  };
}

function formatHitLabel(
  status: string | undefined,
  year: number | undefined,
): string | undefined {
  if (status && /^\d{4}-\d{2}$/.test(status)) {
    const [y, m] = status.split("-");
    return `${y} 年 ${Number(m)} 月`;
  }
  if (status && /^\d{4}$/.test(status)) return `${status} 年`;
  if (year !== undefined) return `${year} 年`;
  return undefined;
}

function parseTrend(blocks: DashboardBlockPublic[]): CpfTrendData | null {
  const charts = blocksOfType(blocks, "chart_series");
  if (
    charts.length === 0 &&
    !findByKey(blocks, "cpf_trend_oa") &&
    !findByKey(blocks, "cpf_trend_sa") &&
    !findByKey(blocks, "cpf_trend_ma")
  ) {
    return null;
  }

  const byAcc = new Map<AccKey, DashboardBlockPublic>();
  const oaK = findByKey(blocks, "cpf_trend_oa");
  const saK = findByKey(blocks, "cpf_trend_sa");
  const maK = findByKey(blocks, "cpf_trend_ma");
  if (oaK) byAcc.set("OA", oaK);
  if (saK) byAcc.set("SA", saK);
  if (maK) byAcc.set("MA", maK);

  const unnamed: DashboardBlockPublic[] = [];
  if (byAcc.size === 0) {
    for (const b of unkeyed(charts)) {
      const t = titleOf(b);
      if (matchTitle(t, "OA", "普通")) byAcc.set("OA", b);
      else if (matchTitle(t, "SA", "特别")) byAcc.set("SA", b);
      else if (matchTitle(t, "MA", "保健")) byAcc.set("MA", b);
      else unnamed.push(b);
    }
  }

  type RawPt = {
    t: string;
    phase: "actual" | "projected";
    grain: "month" | "year";
    OA: number;
    SA: number;
    MA: number;
  };
  const map = new Map<string, RawPt>();

  const ingest = (
    b: DashboardBlockPublic,
    key: AccKey | "total",
  ) => {
    const p = clean(b.payload);
    if (!Array.isArray(p.series)) return;
    for (const item of p.series) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const t = str(r.t)?.trim();
      const v = num(r.v);
      if (!t || v === undefined) continue;
      const phaseRaw = str(r.phase);
      const phase = phaseRaw === "projected" ? "projected" : "actual";
      const grainRaw = str(r.grain);
      const grain =
        grainRaw === "year" || grainRaw === "month"
          ? grainRaw
          : /^\d{4}$/.test(t)
            ? "year"
            : "month";
      const cur = map.get(t) ?? {
        t,
        phase,
        grain,
        OA: 0,
        SA: 0,
        MA: 0,
      };
      if (key === "total") {
        cur.OA = v;
      } else {
        cur[key] = v;
      }
      cur.phase = phase;
      cur.grain = grain;
      map.set(t, cur);
    }
  };

  if (byAcc.size > 0) {
    for (const [k, b] of byAcc) ingest(b, k);
  } else if (unnamed[0]) {
    ingest(unnamed[0], "total");
  } else {
    return null;
  }

  const allPoints: CpfTrendPoint[] = [...map.values()]
    .sort((a, b) => a.t.localeCompare(b.t))
    .map((p) => ({
      t: p.t,
      balances: { OA: p.OA, SA: p.SA, MA: p.MA },
      phase: p.phase,
      grain: p.grain,
    }));
  if (allPoints.length === 0) return null;

  const monthPoints = allPoints.filter((p) => p.grain === "month");
  const points12 =
    monthPoints.length >= 12
      ? monthPoints.slice(-18)
      : monthPoints.length
        ? monthPoints
        : allPoints.slice(-18);

  const primary = byAcc.get("OA") ?? unnamed[0] ?? charts[0];
  const p = clean(primary.payload);

  const events: CpfTrendEvent[] = [];
  if (Array.isArray(p.events)) {
    for (const item of p.events) {
      if (!item || typeof item !== "object") continue;
      const e = item as Record<string, unknown>;
      const t = str(e.t)?.trim();
      const kindRaw = str(e.kind);
      if (!t || (kindRaw !== "employer_change" && kindRaw !== "lump_sum")) {
        continue;
      }
      events.push({
        t,
        kind: kindRaw,
        label:
          str(e.label) ??
          (kindRaw === "lump_sum" ? "一次性转入" : "换雇主"),
        short: str(e.label),
      });
    }
  }

  const rangeRaw = str(p.range_default);
  return {
    points12,
    pointsAll: allPoints,
    events,
    guides: [],
    defaultRange: rangeRaw === "all" ? "all" : "12m",
  };
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  const s = raw.trim();
  if (!s.startsWith("{")) return null;
  try {
    const v = JSON.parse(s) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function parseContrib(blocks: DashboardBlockPublic[]): CpfContribData | null {
  const list =
    findByKey(blocks, "cpf_contrib") ??
    unkeyed(blocksOfType(blocks, "list")).find((b) =>
      matchTitle(titleOf(b), "本月缴存", "缴存"),
    );
  if (!list) return null;
  const p = clean(list.payload);
  if (!Array.isArray(p.items) || p.items.length === 0) return null;
  const first = typeof p.items[0] === "string" ? p.items[0] : null;
  if (!first) return null;
  const obj = tryParseJsonObject(first);
  if (!obj) return null;
  const OA = num(obj.OA);
  const SA = num(obj.SA);
  const MA = num(obj.MA);
  const employer = num(obj.employer);
  const self = num(obj.self);
  const total = num(obj.total);
  const annualLimit = num(obj.annual_limit);
  const paidYtd = num(obj.paid_ytd);
  const limitLeft = num(obj.limit_left);
  if (
    OA === undefined ||
    SA === undefined ||
    MA === undefined ||
    employer === undefined ||
    self === undefined ||
    total === undefined ||
    annualLimit === undefined ||
    paidYtd === undefined ||
    limitLeft === undefined
  ) {
    return null;
  }
  return {
    OA,
    SA,
    MA,
    employer,
    self,
    total,
    annualLimit,
    paidYtd,
    limitLeft,
    asOfMonth: str(obj.as_of_month)?.trim() ?? "",
    note: str(obj.note),
  };
}

function parseAnnual(blocks: DashboardBlockPublic[]): CpfAnnualData | null {
  const metrics = blocksOfType(blocks, "metric");
  const interestUnkeyed = unkeyed(metrics).filter((b) =>
    matchTitle(titleOf(b), "利息"),
  );

  const pickInt = (key: CpfBlockKey, ...needles: string[]) =>
    findByKey(blocks, key) ??
    interestUnkeyed.find((x) => matchTitle(titleOf(x), ...needles));

  const oaBlk = pickInt("cpf_int_oa", "OA", "普通");
  const saBlk = pickInt("cpf_int_sa", "SA", "特别");
  const maBlk = pickInt("cpf_int_ma", "MA", "保健");
  const totBlk =
    findByKey(blocks, "cpf_int_total") ??
    interestUnkeyed.find((b) => matchTitle(titleOf(b), "合计", "总利息"));

  const OA = oaBlk ? num(clean(oaBlk.payload).value) : undefined;
  const SA = saBlk ? num(clean(saBlk.payload).value) : undefined;
  const MA = maBlk ? num(clean(maBlk.payload).value) : undefined;

  const rateOA = oaBlk ? str(clean(oaBlk.payload).label)?.trim() : undefined;
  const rateSA = saBlk ? str(clean(saBlk.payload).label)?.trim() : undefined;
  const rateMA = maBlk ? str(clean(maBlk.payload).label)?.trim() : undefined;
  const showRates = Boolean(rateOA || rateSA || rateMA);

  const interestTotal =
    num(totBlk ? clean(totBlk.payload).value : undefined) ??
    (OA !== undefined && SA !== undefined && MA !== undefined
      ? OA + SA + MA
      : undefined);

  const rstuText =
    findByKey(blocks, "cpf_rstu") ??
    unkeyed(blocksOfType(blocks, "text")).find(
      (b) =>
        matchTitle(titleOf(b), "RSTU") ||
        str(clean(b.payload).empty_text)?.includes("未填补"),
    );

  const paidBlk = findByKey(blocks, "cpf_rstu_paid");
  let rstuPaidLabel: string | undefined;
  let rstuPaidPositive: boolean | undefined;
  if (paidBlk) {
    const pp = clean(paidBlk.payload);
    const paidVal = num(pp.value);
    const paidLabel = str(pp.label)?.trim();
    if (paidLabel) {
      rstuPaidLabel = paidLabel;
    } else if (paidVal !== undefined) {
      rstuPaidLabel = `已填补 S$ ${paidVal.toLocaleString("en-SG")}`;
    }
    if (paidVal !== undefined) {
      rstuPaidPositive = paidVal > 0;
    } else if (paidLabel) {
      rstuPaidPositive = true;
    }
  }

  if (
    OA === undefined ||
    SA === undefined ||
    MA === undefined ||
    interestTotal === undefined
  ) {
    if (rstuText) {
      const p = clean(rstuText.payload);
      const emptyText = str(p.empty_text)?.trim();
      const body = str(p.text)?.trim();
      return {
        yearLabel: titleOf(rstuText) || "年度",
        rates: {
          OA: rateOA || "—",
          SA: rateSA || "—",
          MA: rateMA || "—",
        },
        showRates,
        interest: { OA: 0, SA: 0, MA: 0 },
        interestTotal: 0,
        rstuEmpty: Boolean(emptyText),
        rstuTitle: emptyText ?? "本年未填补",
        rstuBody: body,
        rstuPaidLabel,
        rstuPaidPositive,
      };
    }
    return null;
  }

  const rstuP = rstuText ? clean(rstuText.payload) : null;
  const emptyText = str(rstuP?.empty_text)?.trim();
  const body = str(rstuP?.text)?.trim();
  // empty_text →「本年未填补」空态；有正文 → 展示内容；无块/无正文 → 组件侧「暂无 RSTU 记录」。
  const rstuEmpty = Boolean(emptyText);

  return {
    yearLabel: "年度利息",
    rates: {
      OA: rateOA || "—",
      SA: rateSA || "—",
      MA: rateMA || "—",
    },
    showRates,
    interest: { OA, SA, MA },
    interestTotal,
    rstuEmpty,
    rstuTitle:
      emptyText ??
      (rstuText ? titleOf(rstuText) || undefined : undefined) ??
      "本年未填补",
    rstuBody: body,
    rstuPaidLabel,
    rstuPaidPositive,
  };
}

function parseTodos(blocks: DashboardBlockPublic[]): CpfTodoItem[] | null {
  const list =
    findByKey(blocks, "cpf_todos") ??
    unkeyed(blocksOfType(blocks, "list")).find((b) =>
      matchTitle(titleOf(b), "待办", "相关待办"),
    );
  if (!list) return null;
  const p = clean(list.payload);
  if (!Array.isArray(p.items)) return null;
  const items: CpfTodoItem[] = [];
  for (const raw of p.items) {
    if (typeof raw !== "string") continue;
    const obj = tryParseJsonObject(raw);
    if (obj) {
      const title = str(obj.title)?.trim();
      if (!title) continue;
      items.push({
        title,
        sub: str(obj.sub)?.trim() ?? "",
        due: str(obj.due)?.trim() ?? "",
        overdue: bool(obj.overdue),
        info: bool(obj.info),
        irreversible: bool(obj.irreversible),
      });
      continue;
    }
    if (raw.trim()) {
      items.push({ title: raw.trim(), sub: "", due: "" });
    }
  }
  return items;
}

function parseLedger(blocks: DashboardBlockPublic[]): {
  rows: CpfLedgerRow[] | null;
  summary?: string;
  emptyWithdrawals?: string;
} {
  const list =
    findByKey(blocks, "cpf_ledger") ??
    unkeyed(blocksOfType(blocks, "list")).find((b) =>
      matchTitle(titleOf(b), "流水", "缴存和提取"),
    );
  if (!list) return { rows: null };
  const p = clean(list.payload);
  const emptyText = str(p.empty_text);
  if (!Array.isArray(p.items)) {
    return { rows: [], emptyWithdrawals: emptyText };
  }
  const rows: CpfLedgerRow[] = [];
  for (const raw of p.items) {
    if (typeof raw !== "string") continue;
    const obj = tryParseJsonObject(raw);
    if (!obj) continue;
    const date = str(obj.date)?.trim();
    if (!date) continue;
    const kindRaw = str(obj.kind) ?? "in";
    const kind = kindRaw === "fee" || kindRaw === "out" ? kindRaw : "in";
    const cell = (k: string) => {
      const v = obj[k];
      if (v === null) return null;
      return num(v) ?? null;
    };
    rows.push({
      date,
      kind,
      typeLabel:
        str(obj.type_label) ?? (kind === "in" ? "＋ 缴存" : "－ 扣款"),
      note: str(obj.note)?.trim() ?? "",
      OA: cell("OA"),
      SA: cell("SA"),
      MA: cell("MA"),
      total: num(obj.total) ?? 0,
    });
  }
  return {
    rows,
    summary: str(p.title),
    emptyWithdrawals: emptyText,
  };
}

function parseAssumptions(
  blocks: DashboardBlockPublic[],
): CpfAssumptionsData | null {
  const b =
    findByKey(blocks, "cpf_assumptions") ??
    unkeyed(blocksOfType(blocks, "text")).find((x) =>
      matchTitle(titleOf(x), "估算说明", "假设"),
    );
  if (!b) return null;
  const p = clean(b.payload);
  const text = str(p.text)?.trim() ?? "";
  if (!text) return null;
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  return {
    contribLine: lines[0] ?? "—",
    contribDetail: "",
    rateLine: lines[1] ?? "—",
    rateExtra: "",
    bullets: lines.slice(2),
    byline: "",
  };
}

/** 仅根据 API 分区数据组装；字段名对齐 PR #24 validation schema。 */
export function parseCpfModel(
  section: DashboardSectionPublic,
  pageHeadline = "",
): CpfViewModel {
  const model = emptyCpfViewModel();
  const blocks = section.blocks;
  const { data: progress, reachedFrs } = parseProgress(blocks);
  model.progress = progress;
  model.conclusion = parseConclusion(blocks, pageHeadline, reachedFrs);
  model.accounts = parseAccounts(blocks);
  model.trend = parseTrend(blocks);
  model.contrib = parseContrib(blocks);
  // 户口「本月缴存」合计来自 cpf_contrib.total，不用合计 metric。
  if (model.accounts && model.contrib) {
    model.accounts.monthContribTotal = model.contrib.total;
  }
  model.annual = parseAnnual(blocks);
  model.todos = parseTodos(blocks);
  const ledger = parseLedger(blocks);
  model.ledger = ledger.rows;
  model.ledgerSummary = ledger.summary;
  model.ledgerEmptyWithdrawals = ledger.emptyWithdrawals;
  model.assumptions = parseAssumptions(blocks);
  return model;
}
