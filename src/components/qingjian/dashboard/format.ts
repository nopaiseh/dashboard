/** Format helpers for dashboard UI (no secrets; never print NRIC / CPF account). */

const SENSITIVE_KEY =
  /^(nric|fin|cpf_?account|account_?no|account_?number|身份证|户口号|cpf.?号)/i;

export function isSensitivePayloadKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.trim());
}

export function formatMoney(
  value: number,
  unit = "S$",
  fractionDigits = 0,
): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString("en-SG", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  const sign = value < 0 ? "-" : "";
  const prefix = unit.trim();
  if (!prefix) return `${sign}${formatted}`;
  if (prefix.endsWith("$") || prefix === "S$" || prefix === "$") {
    return `${sign}${prefix} ${formatted}`;
  }
  return `${sign}${formatted} ${prefix}`;
}

export function formatDelta(value: number, unit = "S$"): string {
  if (!Number.isFinite(value) || value === 0) return "较上月持平";
  const abs = formatMoney(Math.abs(value), unit);
  return value > 0 ? `较上月 +${abs}` : `较上月 −${abs}`;
}

export function formatYtd(value: number, unit = "S$", label?: string): string {
  const money = formatMoney(value, unit);
  return label?.trim() ? `${label.trim()} ${money}` : `年初至今 ${money}`;
}

/**
 * Progress percent (0–100, may exceed 100) → fill within band and optional overshoot.
 * Always treat input as percent; do not interpret ≤2 as a 0–1 ratio.
 */
export function progressFill(progress: number): {
  withinPct: number;
  overshootPct: number;
  ratio: number;
} {
  if (!Number.isFinite(progress) || progress <= 0) {
    return { withinPct: 0, overshootPct: 0, ratio: 0 };
  }
  const ratio = progress / 100;
  if (ratio <= 1) {
    return {
      withinPct: Math.round(ratio * 1000) / 10,
      overshootPct: 0,
      ratio,
    };
  }
  // Cap visual overshoot band at +40% of track so layout stays stable.
  const over = Math.min(0.4, ratio - 1);
  return {
    withinPct: 100,
    overshootPct: Math.round(over * 1000) / 10,
    ratio,
  };
}

/** 目标金额 → 刻度文案，如 75000 →「7.5万」、110000 →「11万」。 */
export function formatWan(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "—";
  const wan = amount / 10_000;
  const rounded = Math.round(wan * 10) / 10;
  const label =
    Number.isInteger(rounded) || Math.abs(rounded - Math.round(rounded)) < 1e-9
      ? String(Math.round(rounded))
      : String(rounded);
  return `${label}万`;
}

export function progressCaption(view: {
  reachedTier?: string;
  nextTier?: string;
  nextTierYear?: string;
  overshoot?: number;
  unit?: string;
  target?: string;
}): string | null {
  const parts: string[] = [];
  if (view.reachedTier) {
    const overText =
      view.overshoot != null &&
      Number.isFinite(view.overshoot) &&
      view.overshoot > 0
        ? `，超出 ${formatMoney(view.overshoot, view.unit ?? "S$")}`
        : "";
    parts.push(`已达 ${view.reachedTier}${overText}`);
  }
  if (view.nextTier) {
    const yearBit = view.nextTierYear
      ? ` 预计 ${view.nextTierYear} 年`
      : "";
    parts.push(`下一档 ${view.nextTier}${yearBit}`);
  }
  if (parts.length) return parts.join("；");
  if (view.target) return `目标 ${view.target}`;
  return null;
}

/** Parse ISO-ish `t` (YYYY / YYYY-MM / YYYY-MM-DD) to sortable timestamp. */
export function parsePointTime(t: string): number | null {
  const raw = t.trim();
  if (!raw) return null;
  if (/^\d{4}$/.test(raw)) {
    return Date.parse(`${raw}-12-31T00:00:00+08:00`);
  }
  if (/^\d{4}-\d{2}$/.test(raw)) {
    return Date.parse(`${raw}-01T00:00:00+08:00`);
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

export function pointTimeLabel(t: string, grain: "month" | "year"): string {
  if (grain === "year") {
    const y = t.slice(0, 4);
    return `${y} 年底数`;
  }
  if (/^\d{4}-\d{2}/.test(t)) {
    const [y, m] = t.slice(0, 7).split("-");
    return `${y}年${Number(m)}月 月底数`;
  }
  return `${t} 月底数`;
}
