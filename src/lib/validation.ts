import { z } from "zod";

export const TITLE_MAX = 200;
export const BODY_MAX = 10_000;
export const PROJECT_MAX = 200;
export const OPTION_KEY_MAX = 64;
export const OPTION_LABEL_MAX = 200;
export const OPTIONS_MAX = 20;
export const REPLY_MAX = 5_000;
/** WebAuthn 凭据 ID：规范上限 1023 字节 → 无填充 base64url 最长 1364 字符 */
export const CREDENTIAL_ID_MAX = 1364;

/**
 * assertion / attestation 载荷：限制 id、rawId 长度，其余 WebAuthn 字段透传。
 * 超长在进库前由 zod 拒绝（400）；与其它 body 校验失败一样不计入登录失败锁定。
 */
export const webauthnCredentialPayloadSchema = z
  .object({
    id: z.string().max(CREDENTIAL_ID_MAX).optional(),
    rawId: z.string().max(CREDENTIAL_ID_MAX).optional(),
  })
  .passthrough();

const httpsUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("https://"), {
    message: "source_url must be https",
  });

export const itemOptionSchema = z
  .object({
    key: z.string().min(1).max(OPTION_KEY_MAX),
    label: z.string().min(1).max(OPTION_LABEL_MAX),
  })
  .strict();

export const itemOptionsSchema = z
  .array(itemOptionSchema)
  .max(OPTIONS_MAX)
  .superRefine((opts, ctx) => {
    const keys = opts.map((o) => o.key);
    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: "custom",
        message: "option keys must be unique",
      });
    }
  });

/** 仍支持的条目类型。 */
export const ITEM_KINDS = ["approval", "todo", "waiting"] as const;

/** 已移除；API 收到时返回明确 400。 */
export const REMOVED_ITEM_KINDS = [
  "question_to_user",
  "question_from_user",
] as const;

/**
 * kind 校验：对已移除类型给出清晰错误，其余仅允许 approval / todo / waiting。
 */
export const itemKindSchema = z.string().superRefine((val, ctx) => {
  if ((REMOVED_ITEM_KINDS as readonly string[]).includes(val)) {
    ctx.addIssue({
      code: "custom",
      message: `kind '${val}' has been removed; use approval, todo, or waiting`,
    });
    return;
  }
  if (!(ITEM_KINDS as readonly string[]).includes(val)) {
    ctx.addIssue({
      code: "custom",
      message: "kind must be approval, todo, or waiting",
    });
  }
}).transform((val) => val as (typeof ITEM_KINDS)[number]);

/** 从 zod 错误中取出 kind 相关的明确文案（已移除或非法）。 */
export function kindValidationErrorMessage(
  error: z.ZodError,
): string | undefined {
  const issue = error.issues.find(
    (i) => i.path.length === 1 && i.path[0] === "kind",
  );
  return issue?.message;
}

export const createItemSchema = z
  .object({
    kind: itemKindSchema,
    project: z.string().max(PROJECT_MAX).optional(),
    title: z.string().min(1).max(TITLE_MAX),
    body: z.string().max(BODY_MAX).optional(),
    options: itemOptionsSchema.optional(),
    due_at: z.string().datetime().nullable().optional(),
    source_url: httpsUrl.nullable().optional(),
  })
  .strict();

export const patchItemSchema = z
  .object({
    project: z.string().max(PROJECT_MAX).optional(),
    title: z.string().min(1).max(TITLE_MAX).optional(),
    body: z.string().max(BODY_MAX).optional(),
    options: itemOptionsSchema.optional(),
    due_at: z.string().datetime().nullable().optional(),
    source_url: httpsUrl.nullable().optional(),
    status: z.enum(["done", "withdrawn"]).optional(),
    kind: itemKindSchema.optional(),
  })
  .strict();

export const decisionSchema = z
  .object({
    action: z.enum(["approve", "reject", "reply"]),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    option_key: z.string().min(1).max(OPTION_KEY_MAX).optional(),
    reply_text: z.string().max(REPLY_MAX).optional(),
    assertion: webauthnCredentialPayloadSchema,
    challenge_id: z.string().uuid(),
  })
  .strict();

/** 新设备 invite：须带一次性登记令牌（无公开 bootstrap）。 */
export const registerOptionsSchema = z
  .object({
    token: z.string().min(1).max(512),
  })
  .strict();

export const registerVerifySchema = z
  .object({
    challenge_id: z.string().uuid(),
    attestation: webauthnCredentialPayloadSchema,
  })
  .strict();

export const authVerifySchema = z
  .object({
    challenge_id: z.string().uuid(),
    assertion: webauthnCredentialPayloadSchema,
  })
  .strict();

/** 决定 step-up，或所有者令牌操作 step-up（绑定动作 / agent / token）。 */
export const stepUpOptionsSchema = z.union([
  z
    .object({
      purpose: z.literal("step_up"),
      item_id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal("step_up"),
      action: z.literal("issue_agent_token"),
      agent_id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal("step_up"),
      action: z.literal("revoke_agent_token"),
      agent_id: z.string().uuid(),
      token_id: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      purpose: z.literal("step_up"),
      action: z.literal("create_agent"),
    })
    .strict(),
]);

const agentSlugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: "slug must be lowercase kebab-case",
  });

export const createAgentSchema = z
  .object({
    slug: agentSlugSchema,
    name: z.string().min(1).max(100),
    area: z.string().max(100).default(""),
    bot_id: z.string().max(128).nullable().optional(),
    assertion: webauthnCredentialPayloadSchema,
    challenge_id: z.string().uuid(),
    binding: z.string().min(1).max(4096),
  })
  .strict();

export const issueAgentTokenSchema = z
  .object({
    assertion: webauthnCredentialPayloadSchema,
    challenge_id: z.string().uuid(),
    binding: z.string().min(1).max(4096),
    revoke_previous: z.boolean().optional().default(true),
  })
  .strict();

export const revokeAgentTokenSchema = z
  .object({
    assertion: webauthnCredentialPayloadSchema,
    challenge_id: z.string().uuid(),
    binding: z.string().min(1).max(4096),
  })
  .strict();

export const inviteSchema = z
  .object({
    assertion: webauthnCredentialPayloadSchema,
    challenge_id: z.string().uuid(),
  })
  .strict();

export const inboxQuerySchema = z
  .object({
    since: z.string().datetime().optional(),
  })
  .strict();

export const itemsQuerySchema = z
  .object({
    kind: itemKindSchema.optional(),
    agent: z.string().uuid().optional(),
    status: z
      .enum([
        "open",
        "approved",
        "rejected",
        "replied",
        "done",
        "withdrawn",
      ])
      .optional(),
  })
  .strict();

/** Dashboard section / block API limits. */
export const DASHBOARD_CATEGORY_MAX = 64;
export const DASHBOARD_HEADLINE_MAX = 500;
export const DASHBOARD_LIST_ITEMS_MAX = 50;
export const DASHBOARD_LIST_ITEM_MAX = 500;
export const DASHBOARD_CHART_POINTS_MAX = 366;
export const DASHBOARD_EMPTY_TEXT_MAX = 500;
export const DASHBOARD_TIERS_MAX = 20;
export const DASHBOARD_TIER_KEY_MAX = 64;
export const DASHBOARD_TIER_LABEL_MAX = 200;
export const DASHBOARD_CHART_EVENTS_MAX = 100;
export const DASHBOARD_EVENT_LABEL_MAX = 200;
export const DASHBOARD_MISSING_YEARS_MAX = 50;
export const DASHBOARD_CHART_TIME_MAX = 16;
export const DASHBOARD_YEAR_MIN = 1950;
export const DASHBOARD_YEAR_MAX = 2100;
/** Finite money / quantity bounds for metric/progress/chart values. */
export const DASHBOARD_AMOUNT_MIN = -1_000_000_000_000;
export const DASHBOARD_AMOUNT_MAX = 1_000_000_000_000;
/** Progress ratio / fraction bounds. */
export const DASHBOARD_PROGRESS_MIN = -10;
export const DASHBOARD_PROGRESS_MAX = 100;

export const dashboardBlockTypeSchema = z.enum([
  "headline",
  "metric",
  "progress",
  "list",
  "text",
  "chart_series",
]);

const dashboardFiniteAmount = z
  .number()
  .finite()
  .min(DASHBOARD_AMOUNT_MIN)
  .max(DASHBOARD_AMOUNT_MAX);

const dashboardProgressRatio = z
  .number()
  .finite()
  .min(DASHBOARD_PROGRESS_MIN)
  .max(DASHBOARD_PROGRESS_MAX);

const dashboardEmptyTextSchema = z.string().max(DASHBOARD_EMPTY_TEXT_MAX);
const dashboardYearSchema = z
  .number()
  .int()
  .finite()
  .min(DASHBOARD_YEAR_MIN)
  .max(DASHBOARD_YEAR_MAX);

/** Four-digit year string within DASHBOARD_YEAR_MIN..MAX. */
const dashboardYearStringSchema = z
  .string()
  .regex(/^\d{4}$/)
  .refine((y) => {
    const n = Number(y);
    return n >= DASHBOARD_YEAR_MIN && n <= DASHBOARD_YEAR_MAX;
  });

/**
 * Year or year-month time key (`2026` / `2026-01`) with year in range.
 */
const dashboardChartTimeSchema = z
  .string()
  .min(1)
  .max(DASHBOARD_CHART_TIME_MAX)
  .regex(/^\d{4}(-\d{2})?$/)
  .refine((t) => {
    const y = Number(t.slice(0, 4));
    return y >= DASHBOARD_YEAR_MIN && y <= DASHBOARD_YEAR_MAX;
  });

/** next_tier_year: int year or `YYYY` / `YYYY-MM` string. */
const dashboardNextTierYearSchema = z.union([
  dashboardYearSchema,
  z
    .string()
    .min(4)
    .max(7)
    .regex(/^\d{4}(-\d{2})?$/)
    .refine((t) => {
      const y = Number(t.slice(0, 4));
      return y >= DASHBOARD_YEAR_MIN && y <= DASHBOARD_YEAR_MAX;
    }),
]);

const dashboardMissingYearsSchema = z
  .array(dashboardYearStringSchema)
  .max(DASHBOARD_MISSING_YEARS_MAX);

const progressTierSchema = z
  .array(
    z
      .object({
        key: z.string().min(1).max(DASHBOARD_TIER_KEY_MAX),
        label: z.string().min(1).max(DASHBOARD_TIER_LABEL_MAX),
        amount: dashboardFiniteAmount,
      })
      .strict(),
  )
  .max(DASHBOARD_TIERS_MAX);

const chartSeriesPointSchema = z
  .object({
    t: dashboardChartTimeSchema,
    v: dashboardFiniteAmount,
    phase: z.enum(["actual", "projected"]).optional(),
    grain: z.enum(["month", "year"]).optional(),
  })
  .strict();

const chartEventSchema = z
  .object({
    t: dashboardChartTimeSchema,
    kind: z.enum(["employer_change", "lump_sum"]),
    label: z.string().max(DASHBOARD_EVENT_LABEL_MAX).optional(),
  })
  .strict();

const headlinePayloadSchema = z
  .object({
    text: z.string().max(DASHBOARD_HEADLINE_MAX),
  })
  .strict();

const textPayloadSchema = z
  .object({
    text: z.string().max(BODY_MAX),
    title: z.string().max(TITLE_MAX).optional(),
    empty_text: dashboardEmptyTextSchema.optional(),
    missing_years: dashboardMissingYearsSchema.optional(),
  })
  .strict();

const metricPayloadSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    value: dashboardFiniteAmount,
    unit: z.string().max(64).optional(),
    label: z.string().max(TITLE_MAX).optional(),
    delta_mom: dashboardFiniteAmount.optional(),
    ytd: dashboardFiniteAmount.optional(),
    empty_text: dashboardEmptyTextSchema.optional(),
  })
  .strict();

const progressPayloadSchema = z
  .object({
    title: z.string().min(1).max(TITLE_MAX),
    target: z.string().max(TITLE_MAX).optional(),
    metric: z.string().max(TITLE_MAX).optional(),
    progress: dashboardProgressRatio,
    due_at: z.string().datetime().nullable().optional(),
    status: z.string().max(64).optional(),
    value: dashboardFiniteAmount.optional(),
    unit: z.string().max(64).optional(),
    tiers: progressTierSchema.optional(),
    reached_tier: z.string().min(1).max(DASHBOARD_TIER_KEY_MAX).optional(),
    next_tier: z.string().min(1).max(DASHBOARD_TIER_KEY_MAX).optional(),
    next_tier_year: dashboardNextTierYearSchema.optional(),
    overshoot: dashboardFiniteAmount.optional(),
  })
  .strict();

const listPayloadSchema = z
  .object({
    title: z.string().max(TITLE_MAX).optional(),
    items: z
      .array(z.string().max(DASHBOARD_LIST_ITEM_MAX))
      .max(DASHBOARD_LIST_ITEMS_MAX),
    empty_text: dashboardEmptyTextSchema.optional(),
    missing_years: dashboardMissingYearsSchema.optional(),
  })
  .strict();

const chartSeriesPayloadSchema = z
  .object({
    title: z.string().max(TITLE_MAX).optional(),
    series: z
      .array(chartSeriesPointSchema)
      .max(DASHBOARD_CHART_POINTS_MAX),
    events: z.array(chartEventSchema).max(DASHBOARD_CHART_EVENTS_MAX).optional(),
    all_from_year: dashboardYearSchema.optional(),
    range_default: z.enum(["12m", "all"]).optional(),
  })
  .strict();

/** Payload must match block_type; API still accepts plaintext, DB stores ciphertext. */
export function dashboardPayloadSchemaFor(
  blockType: z.infer<typeof dashboardBlockTypeSchema>,
) {
  switch (blockType) {
    case "headline":
      return headlinePayloadSchema;
    case "text":
      return textPayloadSchema;
    case "metric":
      return metricPayloadSchema;
    case "progress":
      return progressPayloadSchema;
    case "list":
      return listPayloadSchema;
    case "chart_series":
      return chartSeriesPayloadSchema;
    default: {
      const _exhaustive: never = blockType;
      return _exhaustive;
    }
  }
}

export const createDashboardSectionSchema = z
  .object({
    category: z.string().min(1).max(DASHBOARD_CATEGORY_MAX),
    sort_order: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const patchDashboardSectionSchema = z
  .object({
    category: z.string().min(1).max(DASHBOARD_CATEGORY_MAX).optional(),
    sort_order: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

export const createDashboardBlockSchema = z
  .object({
    section_id: z.string().uuid(),
    block_type: dashboardBlockTypeSchema,
    sort_order: z.number().int().min(0).max(1_000_000).optional(),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict()
  .superRefine((val, ctx) => {
    const parsed = dashboardPayloadSchemaFor(val.block_type).safeParse(
      val.payload,
    );
    if (!parsed.success) {
      ctx.addIssue({
        code: "custom",
        message: "invalid payload for block_type",
        path: ["payload"],
      });
    }
  });

export const patchDashboardBlockSchema = z
  .object({
    block_type: dashboardBlockTypeSchema.optional(),
    sort_order: z.number().int().min(0).max(1_000_000).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // Changing type without a matching payload would leave type/content disagreeing.
    if (val.block_type !== undefined && val.payload === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "payload is required when changing block_type",
        path: ["payload"],
      });
      return;
    }
    if (val.payload !== undefined && val.block_type !== undefined) {
      const parsed = dashboardPayloadSchemaFor(val.block_type).safeParse(
        val.payload,
      );
      if (!parsed.success) {
        ctx.addIssue({
          code: "custom",
          message: "invalid payload for block_type",
          path: ["payload"],
        });
      }
    }
  });
