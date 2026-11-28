/**
 * Strict zod schemas for bank dashboard block payloads.
 * All amounts are numbers (±10_000_000); unit is fixed "S$".
 * List items remain JSON strings (parsed here for structure checks).
 * FAKE fixtures only — never real balances / account numbers / NRIC.
 */

import { z } from "zod";
import {
  BANK_ACCOUNT_KEYS,
  BANK_BLOCK_KEYS,
  BANK_GROUPS,
  type BankBlockKey,
  isBankBlockKey,
} from "@/lib/bank-block-keys";
import { amountsEqualInCents } from "@/lib/dashboard/money";
import {
  BODY_MAX,
  DASHBOARD_AMOUNT_MAX,
  DASHBOARD_AMOUNT_MIN,
  DASHBOARD_CHART_POINTS_MAX,
  DASHBOARD_EMPTY_TEXT_MAX,
  DASHBOARD_LIST_ITEM_MAX,
  DASHBOARD_LIST_ITEMS_MAX,
  DASHBOARD_YEAR_MAX,
  DASHBOARD_YEAR_MIN,
  TITLE_MAX,
} from "@/lib/validation";

/** bank_ledger list ceiling (month rows still capped at 12 below). */
export const BANK_LEDGER_LIST_ITEMS_MAX = 200;
/** One ledger row per month; at most a year of months. */
export const BANK_LEDGER_MONTHS_MAX = 12;
/**
 * Max chars for one ledger month JSON string (payload still stores months as
 * JSON strings). 500 was too small for ~200 lines; 32k covers 200 compact lines
 * with headroom while staying a sane overall cap.
 */
export const BANK_LEDGER_MONTH_JSON_MAX = 32_000;
export const BANK_ROLE_TAG_MAX = 12;
export const BANK_STATUS_TEXT_MAX = 40;
export const BANK_NOTE_MAX = 200;
export const BANK_MILESTONES_MAX = 8;
export const BANK_TODOS_MAX = 50;

const bankAmount = z
  .number()
  .finite()
  .min(DASHBOARD_AMOUNT_MIN)
  .max(DASHBOARD_AMOUNT_MAX);

const bankUnit = z.literal("S$");

const bankDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((t) => {
    const y = Number(t.slice(0, 4));
    return y >= DASHBOARD_YEAR_MIN && y <= DASHBOARD_YEAR_MAX;
  });

const bankMonth = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .refine((t) => {
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    return (
      y >= DASHBOARD_YEAR_MIN &&
      y <= DASHBOARD_YEAR_MAX &&
      m >= 1 &&
      m <= 12
    );
  });

const bankAccountKey = z.enum(BANK_ACCOUNT_KEYS);
const bankGroup = z.enum(BANK_GROUPS);

const bankBlockKeySchema = z.enum(BANK_BLOCK_KEYS);

/** Progress may exceed 100 (overshoot); must be ≥ 0. */
const bankProgressValue = z.number().finite().min(0);

function parseJsonItem<T>(
  raw: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false } {
  try {
    const parsed: unknown = JSON.parse(raw);
    const result = schema.safeParse(parsed);
    if (!result.success) return { ok: false };
    return { ok: true, value: result.data };
  } catch {
    return { ok: false };
  }
}

function jsonStringItems<T>(
  itemSchema: z.ZodType<T>,
  maxItems: number,
  refineItems?: (items: T[], ctx: z.RefinementCtx) => void,
  maxItemChars: number = DASHBOARD_LIST_ITEM_MAX,
) {
  return z
    .array(z.string().max(maxItemChars))
    .max(maxItems)
    .superRefine((rawItems, ctx) => {
      const parsed: T[] = [];
      for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i]!;
        const result = parseJsonItem(item, itemSchema);
        if (!result.ok) {
          ctx.addIssue({
            code: "custom",
            message: "invalid list item",
            path: [i],
          });
          return;
        }
        parsed.push(result.value);
      }
      refineItems?.(parsed, ctx);
    });
}

const bankMilestoneSchema = z
  .object({
    t: bankMonth,
    amount: bankAmount,
  })
  .strict();

const bankProgressPayloadSchema = z
  .object({
    block_key: bankBlockKeySchema,
    title: z.string().min(1).max(TITLE_MAX),
    account_key: bankAccountKey,
    kind: z.enum(["savings", "floor", "budget", "streak", "room"]),
    value: bankAmount,
    target: bankAmount,
    unit: bankUnit,
    progress: bankProgressValue,
    monthly_needed: bankAmount.optional(),
    due: bankMonth,
    status: z.enum(["on_track", "ahead", "behind", "no_target"]),
    status_text: z.string().max(BANK_STATUS_TEXT_MAX),
    milestones: z.array(bankMilestoneSchema).max(BANK_MILESTONES_MAX),
    label: z.string().max(TITLE_MAX),
    note: z.string().max(BANK_NOTE_MAX),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.kind === "savings" && val.monthly_needed === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "monthly_needed required for savings",
        path: ["monthly_needed"],
      });
    }
  });

const bankAccMetricSchema = z
  .object({
    block_key: bankBlockKeySchema,
    title: z.string().min(1).max(TITLE_MAX),
    role_tag: z.string().min(1).max(BANK_ROLE_TAG_MAX),
    group: bankGroup,
    value: bankAmount,
    delta_mom: bankAmount.optional(),
    ytd: bankAmount.optional(),
    label: z.string().max(TITLE_MAX),
    unit: bankUnit,
  })
  .strict();

const bankNetMetricSchema = z
  .object({
    block_key: bankBlockKeySchema,
    value: bankAmount,
    cash_total: bankAmount,
    liab_total: bankAmount,
    label: z.string().max(TITLE_MAX),
    unit: bankUnit,
  })
  .strict()
  .superRefine((val, ctx) => {
    const expected = val.cash_total - val.liab_total;
    if (!amountsEqualInCents(val.value, expected)) {
      ctx.addIssue({
        code: "custom",
        message: "value must equal cash_total - liab_total",
        path: ["value"],
      });
    }
  });

const bankLiabItemSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    kind: z.enum(["card_statement", "grab_ledger", "other"]),
    amount: bankAmount,
    due: bankDate,
    estimated: z.boolean(),
    note: z.string().max(BANK_NOTE_MAX),
  })
  .strict();

const bankAllocItemSchema = z
  .object({
    account_key: bankAccountKey,
    label: z.string().min(1).max(TITLE_MAX),
    planned: bankAmount,
    actual: bankAmount.optional(),
    status: z.enum(["pending", "partial", "done", "over"]),
  })
  .strict();

const bankLedgerLineSchema = z
  .object({
    kind: z.enum(["in", "out"]),
    category: z.enum([
      "salary",
      "loan",
      "card",
      "support",
      "food",
      "transport",
      "subscription",
      "tax",
      "gift",
      "travel",
      "invest",
      "other",
    ]),
    amount: bankAmount,
  })
  .strict();

const bankLedgerMonthSchema = z
  .object({
    month: bankMonth,
    in_total: bankAmount,
    out_total: bankAmount,
    lines: z.array(bankLedgerLineSchema).max(BANK_LEDGER_LIST_ITEMS_MAX),
  })
  .strict()
  .superRefine((val, ctx) => {
    const inSum = val.lines
      .filter((l) => l.kind === "in")
      .reduce((s, l) => s + l.amount, 0);
    const outSum = val.lines
      .filter((l) => l.kind === "out")
      .reduce((s, l) => s + l.amount, 0);
    if (!amountsEqualInCents(val.in_total, inSum)) {
      ctx.addIssue({
        code: "custom",
        message: "in_total must equal sum of in lines",
        path: ["in_total"],
      });
    }
    if (!amountsEqualInCents(val.out_total, outSum)) {
      ctx.addIssue({
        code: "custom",
        message: "out_total must equal sum of out lines",
        path: ["out_total"],
      });
    }
  });

const bankTodoItemSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    sub: z.string().max(DASHBOARD_LIST_ITEM_MAX),
    due: bankDate,
    overdue: z.boolean().optional(),
    info: z.boolean().optional(),
    irreversible: z.boolean().optional(),
  })
  .strict();

const bankTrendPointSchema = z
  .object({
    t: bankMonth,
    v: bankAmount,
    phase: z.enum(["actual", "projected"]),
    grain: z.literal("month"),
  })
  .strict();

const bankTrendPayloadSchema = z
  .object({
    block_key: bankBlockKeySchema,
    title: z.string().min(1).max(TITLE_MAX),
    account_key: bankAccountKey,
    series: z.array(bankTrendPointSchema).max(DASHBOARD_CHART_POINTS_MAX),
    range_default: z.enum(["12m", "all"]),
    unit: bankUnit,
  })
  .strict();

const bankTextPayloadSchema = z
  .object({
    block_key: bankBlockKeySchema,
    text: z.string().max(BODY_MAX),
    title: z.string().max(TITLE_MAX).optional(),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const bankLiabListSchema = z
  .object({
    block_key: bankBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    items: jsonStringItems(bankLiabItemSchema, DASHBOARD_LIST_ITEMS_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const bankAllocListSchema = z
  .object({
    block_key: bankBlockKeySchema,
    month: bankMonth,
    title: z.string().max(TITLE_MAX).optional(),
    items: jsonStringItems(bankAllocItemSchema, DASHBOARD_LIST_ITEMS_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const bankLedgerListSchema = z
  .object({
    block_key: bankBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    items: jsonStringItems(
      bankLedgerMonthSchema,
      BANK_LEDGER_LIST_ITEMS_MAX,
      (months, ctx) => {
        if (months.length > BANK_LEDGER_MONTHS_MAX) {
          ctx.addIssue({
            code: "custom",
            message: `bank_ledger allows at most ${BANK_LEDGER_MONTHS_MAX} months`,
          });
          return;
        }
        for (let i = 1; i < months.length; i++) {
          if (months[i - 1]!.month <= months[i]!.month) {
            ctx.addIssue({
              code: "custom",
              message: "bank_ledger months must be descending",
              path: [i, "month"],
            });
            return;
          }
        }
      },
      BANK_LEDGER_MONTH_JSON_MAX,
    ),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const bankTodosListSchema = z
  .object({
    block_key: bankBlockKeySchema,
    title: z.string().max(TITLE_MAX).optional(),
    items: jsonStringItems(bankTodoItemSchema, BANK_TODOS_MAX),
    empty_text: z.string().max(DASHBOARD_EMPTY_TEXT_MAX).optional(),
  })
  .strict();

const BANK_ACC_KEYS = new Set(
  BANK_BLOCK_KEYS.filter((k) => k.startsWith("bank_acc_")),
);
const BANK_PROG_KEYS = new Set(
  BANK_BLOCK_KEYS.filter((k) => k.startsWith("bank_prog_")),
);
const BANK_TREND_KEYS = new Set(
  BANK_BLOCK_KEYS.filter((k) => k.startsWith("bank_trend_")),
);

/**
 * Expected block_type for a bank block_key (used by upsert path).
 */
export function expectedBankBlockType(
  blockKey: BankBlockKey,
):
  | "text"
  | "metric"
  | "progress"
  | "list"
  | "chart_series" {
  if (
    blockKey === "bank_conclusion" ||
    blockKey === "bank_assumptions"
  ) {
    return "text";
  }
  if (BANK_ACC_KEYS.has(blockKey) || blockKey === "bank_net") {
    return "metric";
  }
  if (BANK_PROG_KEYS.has(blockKey)) {
    return "progress";
  }
  if (BANK_TREND_KEYS.has(blockKey)) {
    return "chart_series";
  }
  return "list";
}

/**
 * Strict-parse a bank payload for the given block_type + block_key.
 * `block_key` must already be a bank key and should match payload.block_key.
 */
export function parseBankBlockPayload(
  blockType: string,
  payload: unknown,
  blockKey: string,
): { ok: true; data: Record<string, unknown> } | { ok: false } {
  if (!isBankBlockKey(blockKey)) {
    return { ok: false };
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return { ok: false };
  }
  const record = payload as Record<string, unknown>;
  if (record.block_key !== blockKey) {
    return { ok: false };
  }
  if (expectedBankBlockType(blockKey) !== blockType) {
    return { ok: false };
  }

  let schema: z.ZodType;
  if (
    blockKey === "bank_conclusion" ||
    blockKey === "bank_assumptions"
  ) {
    schema = bankTextPayloadSchema;
  } else if (BANK_ACC_KEYS.has(blockKey)) {
    schema = bankAccMetricSchema;
  } else if (blockKey === "bank_net") {
    schema = bankNetMetricSchema;
  } else if (BANK_PROG_KEYS.has(blockKey)) {
    schema = bankProgressPayloadSchema;
  } else if (BANK_TREND_KEYS.has(blockKey)) {
    schema = bankTrendPayloadSchema;
  } else if (blockKey === "bank_liab") {
    schema = bankLiabListSchema;
  } else if (blockKey === "bank_alloc") {
    schema = bankAllocListSchema;
  } else if (blockKey === "bank_ledger") {
    schema = bankLedgerListSchema;
  } else if (blockKey === "bank_todos") {
    schema = bankTodosListSchema;
  } else {
    return { ok: false };
  }

  const parsed = schema.safeParse(record);
  if (!parsed.success) {
    return { ok: false };
  }
  return { ok: true, data: parsed.data as Record<string, unknown> };
}
