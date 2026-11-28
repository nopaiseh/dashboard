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

/** 首次登记可无 token（靠 setup-grant cookie）；新设备 invite 须带 token。 */
export const registerOptionsSchema = z
  .object({
    token: z.string().min(1).max(512).optional(),
  })
  .strict();

export const registerVerifySchema = z
  .object({
    challenge_id: z.string().uuid(),
    attestation: webauthnCredentialPayloadSchema,
  })
  .strict();

export const setupRequestSchema = z
  .object({
    email: z.string().email().max(320),
  })
  .strict();

export const setupConfirmSchema = z
  .object({
    token_hash: z.string().min(1).max(2048),
    type: z.literal("email"),
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
