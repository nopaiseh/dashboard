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

export const createItemSchema = z
  .object({
    kind: z.enum([
      "approval",
      "todo",
      "question_to_user",
      "question_from_user",
      "waiting",
    ]),
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
    kind: z
      .enum([
        "approval",
        "todo",
        "question_to_user",
        "question_from_user",
        "waiting",
      ])
      .optional(),
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

export const stepUpOptionsSchema = z
  .object({
    purpose: z.literal("step_up"),
    item_id: z.string().uuid(),
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
    kind: z
      .enum([
        "approval",
        "todo",
        "question_to_user",
        "question_from_user",
        "waiting",
      ])
      .optional(),
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
