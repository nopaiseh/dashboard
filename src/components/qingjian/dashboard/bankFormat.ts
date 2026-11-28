/**
 * 银行看板展示规则（假数据 / 真实块共用）：
 * - 缺数据 →「暂无数据」
 * - 0 → S$0.00
 * - 首月无比上月 →「—」
 * - 进度 >100% → 显示真实值并用红色警示
 * - 无目标 →「未开始」
 * - 负净额红色（由调用方加 class）
 * - 数字入参必须是 number；非 number 视为缺数据
 */

export const BANK_EMPTY = "暂无数据";
export const BANK_NO_COMPARE = "—";
export const BANK_NOT_STARTED = "未开始";

/** 仅接受有限 number；其它一律视为缺数据。 */
export function asBankNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 金额展示：缺 → 暂无数据；0 → S$0.00；负号用 Unicode −。
 * 默认两位小数，与设计稿一致。
 */
export function formatBankMoney(
  value: unknown,
  fractionDigits = 2,
): string {
  const n = asBankNumber(value);
  if (n === null) return BANK_EMPTY;
  // 先四舍五入到展示精度再判正负，避免 −0.004 →「−S$0.00」
  const factor = 10 ** fractionDigits;
  const rounded = Math.round(n * factor) / factor;
  if (rounded === 0) {
    return `S$${Number(0).toLocaleString("en-SG", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })}`;
  }
  const abs = Math.abs(rounded).toLocaleString("en-SG", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const sign = rounded < 0 ? "−" : "";
  return `${sign}S$${abs}`;
}

/**
 * 比上月 / 比年初：缺（undefined/null）→「—」；有值（含 0）→ 金额。
 * 正负箭头由调用方加 ▲/▼。
 */
export function formatBankCompare(value: unknown): string {
  const n = asBankNumber(value);
  if (n === null) return BANK_NO_COMPARE;
  return formatBankMoney(Math.abs(n));
}

export type BankCompareTone = "pos" | "neg" | "mut" | "empty";

export function bankCompareTone(value: unknown): BankCompareTone {
  const n = asBankNumber(value);
  if (n === null) return "empty";
  if (n > 0) return "pos";
  if (n < 0) return "neg";
  return "mut";
}

export function bankCompareArrow(value: unknown): string {
  const n = asBankNumber(value);
  if (n === null || n === 0) return "";
  return n > 0 ? "▲" : "▼";
}

/**
 * 进度百分比文案。无目标 →「未开始」；缺 progress →「暂无数据」；
 * 超过 100 仍显示真实整数百分比。
 */
export function formatBankProgressPct(
  progress: unknown,
  opts?: { hasTarget?: boolean },
): string {
  if (opts?.hasTarget === false) return BANK_NOT_STARTED;
  const n = asBankNumber(progress);
  if (n === null) return BANK_EMPTY;
  const rounded = Math.round(n);
  return `${rounded}%`;
}

export function isBankProgressOver(progress: unknown): boolean {
  const n = asBankNumber(progress);
  return n !== null && n > 100;
}

/** 超出部分百分比文案，如 progress=120 →「超出 20%」。 */
export function formatBankOvershootLabel(progress: unknown): string | null {
  const n = asBankNumber(progress);
  if (n === null || n <= 100) return null;
  return `超出 ${Math.round(n - 100)}%`;
}

/**
 * 银行 `unit` 白名单：取值与拼写对齐后端 #40 `bank-validation.ts` 的
 * `BANK_UNITS` / `BankUnit`（["S$", "月"]）。
 * 本分支不改 bank-validation；#40 合并后可改为直接引用其导出。
 */
export const BANK_UNITS = ["S$", "月"] as const;
export type BankUnit = (typeof BANK_UNITS)[number];

export function isBankUnit(unit: unknown): unit is BankUnit {
  return (
    typeof unit === "string" &&
    (BANK_UNITS as readonly string[]).includes(unit)
  );
}

/**
 * 进度主数值 / 里程碑金额共用：按 unit 格式化。
 * - "S$" → 现有金额格式（S$1,000.00）
 * - "月" →「N 个月」
 * - 白名单外 → 只显示数字（页面不崩）
 */
export function formatBankProgressValue(
  value: unknown,
  unit: string | undefined,
  fractionDigits = 2,
): string {
  const n = asBankNumber(value);
  if (n === null) return BANK_EMPTY;
  if (unit === "S$") return formatBankMoney(n, fractionDigits);
  if (unit === "月") return `${Math.round(n)} 个月`;
  // 未知 unit：纯数字兜底
  const rounded = Math.round(n * 100) / 100;
  const digits = Number.isInteger(rounded) ? 0 : 2;
  const abs = Math.abs(rounded).toLocaleString("en-SG", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return rounded < 0 ? `−${abs}` : abs;
}

/** 里程碑标签：`2027-12 · 12 个月` / `2027-06 · S$4,000.00`。 */
export function formatBankMilestoneLabel(
  t: string,
  amount: unknown,
  unit: string | undefined,
  fractionDigits = 2,
): string {
  return `${t} · ${formatBankProgressValue(amount, unit, fractionDigits)}`;
}

/**
 * 进度条填充分段：within ≤100% 的轨道占比；over 为超出视觉带（相对 100% 轨道，封顶 40%）。
 */
export function bankProgressFill(progress: unknown): {
  withinPct: number;
  overshootPct: number;
  over: boolean;
} {
  const n = asBankNumber(progress);
  if (n === null || n <= 0) {
    return { withinPct: 0, overshootPct: 0, over: false };
  }
  if (n <= 100) {
    return {
      withinPct: Math.round(n * 10) / 10,
      overshootPct: 0,
      over: false,
    };
  }
  const over = Math.min(40, Math.round((n - 100) * 10) / 10);
  return { withinPct: 100, overshootPct: over, over: true };
}

export type BankStatusChipKind = "ok" | "warn" | "red" | "neutral";

/** 状态徽章样式：无目标中性；超 100% 红；落后警告；其余成功。 */
export function bankStatusChipKind(
  status: string | undefined,
  progress: unknown,
): BankStatusChipKind {
  if (status === "no_target") return "neutral";
  if (isBankProgressOver(progress)) return "red";
  if (status === "behind") return "warn";
  if (status === "on_track" || status === "ahead") return "ok";
  return "neutral";
}

export function bankStatusChipClass(kind: BankStatusChipKind): string {
  switch (kind) {
    case "ok":
      return "chip chipOk";
    case "warn":
      return "chip chipWarn";
    case "red":
      return "chip chipRed";
    default:
      return "chip chipNeutral";
  }
}

/** 净额是否应按红色警示展示。 */
export function isBankNetNegative(value: unknown): boolean {
  const n = asBankNumber(value);
  return n !== null && n < 0;
}

/**
 * 从 bank_conclusion.text 拆出正文与「最紧」提示。
 * 约定：以「最紧：」或「最紧:」起头的行及其后内容为 urgent。
 */
export function splitBankConclusionText(text: string): {
  body: string;
  urgent: string | null;
} {
  const raw = text.replace(/\r\n/g, "\n").trim();
  if (!raw) return { body: "", urgent: null };
  const lines = raw.split("\n");
  const urgentIdx = lines.findIndex((l) => /^最紧\s*[：:]/.test(l.trim()));
  if (urgentIdx < 0) {
    return { body: raw, urgent: null };
  }
  const body = lines.slice(0, urgentIdx).join("\n").trim();
  const first = lines[urgentIdx]!.trim().replace(/^最紧\s*[：:]\s*/, "");
  const rest = lines.slice(urgentIdx + 1).join("\n").trim();
  const urgent = [first, rest].filter(Boolean).join("\n").trim();
  return { body, urgent: urgent || null };
}

/**
 * 结论标题里把负金额标红（em），正金额/日期保持普通文本。
 * 匹配 −S$… / -S$… / S$…。
 */
export function splitBankConclusionTitle(
  text: string,
): Array<{ text: string; danger?: boolean }> {
  const re = /([−\-]?S\$\s*[\d,]+(?:\.\d+)?)/g;
  const out: Array<{ text: string; danger?: boolean }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: text.slice(last, idx) });
    const token = m[0];
    const isNeg = token.startsWith("−") || token.startsWith("-");
    out.push({
      text: isNeg && token.startsWith("-") ? `−${token.slice(1)}` : token,
      danger: isNeg,
    });
    last = idx + token.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

/** 拨款进度：actual/planned；无 planned 或 planned≤0 → 空条。 */
export function bankAllocFill(
  planned: unknown,
  actual: unknown,
): { withinPct: number; overshootPct: number; over: boolean } {
  const p = asBankNumber(planned);
  const a = asBankNumber(actual);
  if (p === null || p <= 0 || a === null) {
    return { withinPct: 0, overshootPct: 0, over: false };
  }
  return bankProgressFill((a / p) * 100);
}
