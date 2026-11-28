# 玄机阁架构说明

私人事务面板后端骨架。部署目标：Vercel（函数区 `sin1` / 新加坡），域名 `desk.nopaiseh.com`。数据库为独立 Supabase 项目 `ifirvlbeaookzhvvcdzs`。浏览器端不持有任何数据库密钥；全部数据访问经 Next.js Route Handlers 使用 **service role**。

> 注意：本仓库已开 Supabase「Deploy to production」（分支 `main`）。合并到 `main` 后迁移会自动上 prod。

**预览构建**：`vercel.json` 的 `ignoreCommand`（`scripts/vercel-ignore-build.sh`）会跳过多数预览部署以省费用；生产永远构建。需要预览时在**提交 subject（第一行）**加 `[preview]`，或改动前端界面文件（详见脚本注释）。

## 表结构

| 对象 | 说明 |
|------|------|
| `agents` | 姐妹（slug / name / area / bot_id） |
| `agent_tokens` | Bearer 令牌 sha256；`revoked_at` 可作废重发（令牌本身不带分类白名单） |
| `items` | 事项；`content_hash` = sha256(JSON.stringify([kind, title, body, options, source_url, normalize(due_at)]))；`due_at` 比对前统一 `toISOString()` |
| `item_events` | 只增不改（禁止 UPDATE/DELETE/TRUNCATE）；决定记录 credential_id、verified_at、content_hash |
| `dashboard_writers` | 看板写入人多对多（PK `(category, agent_id)`）；列表为空则该分类一切 agent 写入 403；仅 owner（session + step-up）可添加/移除。回填：普通分类全员；`cpf`/`bank` 仅当唯一 cpf 拥有者时回填一次；`travel` 从不回填（仅 owner 指定） |
| `dashboard_sections` / `dashboard_blocks` | 通用 dashboard 分区/区块；敏感内容在 `payload`（应用层加密）；可选明文 `block_key` + 部分唯一索引 `(section_id, block_key)` |
| `dashboard_block_events` | 区块审计，只增不改（禁止 UPDATE/DELETE/TRUNCATE） |
| `daily_summaries` | 每日小结 |
| `webauthn_credentials` | 本人 passkey |
| `webauthn_registration` | 单行：`open` **默认 false**；`one_time_token_hash`；历史列 `bootstrap_consumed_at` / `consumed_setup_grant_jti` 仍在库中（首次登记路径已从应用层移除，无新写入） |
| `webauthn_challenges` | 短时 challenge；注册挑战带 `authorized=true` |
| `login_attempts` | 只按 IP 锁定；凭据 / 全站只告警；`auth_options` 限流计数 |
| `stale_items` | open 且 7 天无活动（`security_invoker`） |

全部表 RLS 开启，不给 anon/authenticated 策略。`item_events` 对 service_role 收回 UPDATE/DELETE/TRUNCATE。函数均 `SET search_path = public, pg_temp`。

种子：`supabase/seed.sql` 十二位姐妹占位。

## 注册与认证

1. **首次登记已关闭**：`/setup`、`/setup/confirm`、`/api/auth/setup/*` 一律 **404**。无魔法链接、无 setup-grant、应用层不再走 `bootstrap` 模式。
2. **新设备（已登录 invite）**：已登录 + 现场 passkey → `POST /api/auth/register/invite` 签发短时一次性令牌；新设备持令牌调用 `POST /api/auth/register/options`（`one_time`）→ WebAuthn 登记 → `verify`。`pubKeyCredParams` **仅** ES256 (`-7`) 与 RS256 (`-257`)，禁止 ML-DSA-44 (`-48`)。`residentKey` 仍为 `required`。目前**无 UI** 暴露 invite；API 保留不变。
3. **登录**：会话 cookie 闲置 12h，绝对上限 7 天（`iat` 首次签发，滑动续期不改）；锁定逻辑集中 `evaluateLoginLockout`（只按 IP 锁 15 分钟；凭据与全站失败只告警——options 未登录可拿到凭据 ID，按凭据锁会被换 IP 锁死主人）。
4. **决定 / 所有者操作 step-up**：须带 `content_hash` 或动作绑定；挑战抢占；前端只见通用错误。
5. **丢失全部 passkey**：无自助恢复。须在 Supabase 侧人工介入（例如 SQL 写入 invite one-time token 或新凭据）后再登录。

## 姐妹接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/items` | 新建 |
| PATCH | `/api/agent/items/:id` | RPC `apply_agent_item_patch` 单事务 FOR UPDATE；不回写旧 status；冲突 `SQLSTATE XJ409`→409；approval 且 open 时只能 `withdrawn`；改内容 → 退回 open；**内容字段与 `status: withdrawn` 同时传入 → 400**；有本人决定后禁改 kind |
| GET | `/api/agent/inbox?since=` | 已决定事项 + 流水；`invalidated` 表示内容事后变更 |
| POST | `/api/agent/dashboard/sections` | 新建分区（须为该 `category` 的 `dashboard_writers` 写入人） |
| PATCH | `/api/agent/dashboard/sections/:id` | 更新分区（须为当前/目标分类写入人） |
| POST | `/api/agent/dashboard/blocks` | 新建区块（加密 payload；无 DELETE；须为分区分类写入人） |
| PATCH | `/api/agent/dashboard/blocks/:id` | 更新区块（须为分区分类写入人） |
| PUT | `/api/agent/dashboard/sections/:id/blocks/:block_key` | 按 `block_key` upsert（明文列 + 唯一索引；RPC 原子） |
| GET/POST/DELETE | `/api/owner/dashboard/writers` | 所有者列出/添加/移除看板写入人（POST/DELETE 须 passkey step-up） |

## 本人读接口

`GET /api/items`、`/api/dashboard`、`/api/summaries`（需登录）。决定无批量接口。

### Dashboard 加密字段

| 明文 | 密文（`dashboard_blocks.payload` JSON） |
|------|----------------------------------------|
| `category`、`block_type`、`sort_order`、`agent_id`、可选 `block_key`、时间戳 | 标题、数值、正文、一行标题、列表、进度、图表序列等 |

`block_key` 按分区白名单：`bank` → `BANK_BLOCK_KEYS`；`cpf` → `CPF_BLOCK_KEYS`；`travel` → `travel_<slot>` / `travel_<trip>_<slot>`；其他维持原状。银行区块另有严格字段与等式校验（`unit` 白名单 `S$`/`月`；详见 `docs/agent-api.md`）；旅行区块另有严格字段校验。隐私拦截：禁用键名（含 card/iban/swift/pan/last4/passport/bookingref/pnr 等）与连续 ≥9 位数字 / NRIC / 护照形态 / 订票码关键词 → 整包 `400`（不回显命中内容；`bank_ledger` 月 JSON 扫描上限 32k，其它嵌入 JSON 10k）。zod 失败另附固定中文 `issues`（不含提交值）。所有者读路径（`GET /api/dashboard`）对所有分区（含 bank / travel）一律会话保护，与 CPF 相同。

AAD：`dashboard_blocks:{id}:payload:v{N}`（与 items 共用密钥环；按信封版本查密钥）。`payload` 仅允许 `''` 或 `^v[0-9]+:` 前缀（无遗留明文）。服务端派生值接口：`runDerivedCompute`（内存解密→计算→返回；不落库/不缓存/不打明文日志）。

## 防护

- `src/proxy.ts`：`SESSION_SECRET` 缺失或短于 32 字节一律拒绝；静态资源白名单；未登录 → `/login` 或 401；**会话滑动续期在此写 cookie**（页面内不可 `cookies().set`）。
- CSP：proxy 每请求生成 nonce，`script-src 'self' 'nonce-…' 'strict-dynamic'`（生产无 unsafe-inline/unsafe-eval），经 `x-nonce` 交给 Next。受保护页 / `not-found` / 登录等**全动态**（先 `connection()`/`cookies()` 再判密钥），避免无密钥构建固化跳转；页面不用 `style={{}}`。
- `(protected)/layout` 再验会话（只校验，不续期）。
- Cookie 写操作校验 Origin；登录/注册 options 库内限流；登录失败计数经 `record_login_failure_atomic` 原子 upsert（读锁定状态或 RPC 失败则 fail closed；`locked` 时 verify 返回 429）。
- RPC：`REVOKE EXECUTE FROM public, anon, authenticated`，仅 `service_role`；冲突/禁止/未找到用自定义 SQLSTATE `XJ409` / `XJ403` / `XJ404`。
- 安全头：HSTS、`frame-ancestors 'none'`、`Referrer-Policy: no-referrer`、`X-Robots-Tag`。
- **姐妹 Bearer 限流**：查表前对本实例 `agent:invalid` 内存桶做只读预检（超限且非近期有效哈希 → 直接 429）；再查并校验令牌，再调 `rate_limit_buckets` + `rate_limit_check`（跨实例）。有效令牌键 `agent:`+哈希（60/分 + 1000/日）；无效/未知/吊销共用 `agent:invalid`（同额度，并同步 bump 进程内桶）。RPC 失败或 ~1.5s 超时回退 `src/lib/rate-limit.ts`。清理约 1% 调用、每次最多 500 行。登录与 `register/options` 另有专用 DB 限流。

## 输入校验

- `source_url` 仅 https；`due_at` 为 ISO datetime；标题/正文/选项有长度与数量上限；选项 key 唯一；zod `.strict()`。
- WebAuthn `assertion` / `attestation` 的 `id`、`rawId` 最长 **1364** 字符（1023 字节凭据 ID 的无填充 base64url）；超长在进库前 400。属 body 校验失败，**不**计入 IP 登录失败锁定（与其它 zod 拒绝一致，避免垃圾超长请求被用来锁 IP）。

## 字段加密

`items.title`、`items.body`、`items.source_url` 在写入 Supabase 前于服务器用 **AES-256-GCM** 加密，读出后再解密。实现：`src/lib/crypto/fields.ts`（`server-only`）/ `fields-core.ts`。

- **信封格式**：`v{N}:{iv_b64}:{tag_b64}:{ciphertext_b64}`（每值随机 12 字节 IV；GCM tag；密文段可为**空**——空字符串 `body`）。
- **AAD**：`items:{id}:{column}:v{N}`，防止跨行/跨列调换密文。新建事项时在应用层 `randomUUID()` 预生成 `id` 再加密后插入。
- **content_hash**：`HMAC-SHA256(CONTENT_HASH_KEY, JSON.stringify([kind, title, body, options, source_url, due_at]))`（密钥与字段加密分离）。过渡期 `matchesStoredContentHash` 仍接受旧版纯 SHA-256，避免 PATCH/决定误判；`FIELD_ENCRYPTION_STRICT=1` 后只接受 HMAC。
- **遗留明文**：非严格模式下无信封则原样返回。回填 `scripts/encrypt-existing-fields.ts`（默认 `--dry-run`）须指定 `--encrypt-only` 或 `--rehash-only`；CAS；幂等。**切勿未审阅对生产执行。** `--rehash-only --execute` **直接拒绝**（事件表方案待定，仅允许 dry-run）。
- **密钥环**：`FIELD_ENCRYPTION_KEY` / `FIELD_ENCRYPTION_KEY_Vn` / `FIELD_ENCRYPTION_KEYS` + `FIELD_ENCRYPTION_KEY_CURRENT`；`KEY` 与 `KEY_V1` 同时设置且值不同 → 报错。密钥须严格 base64、恰好 32 字节。密钥环加载失败一律抛出；信封版本不在环内 → 该行降级（`unknown_key_version`），不 500 整页。
- **单行解密失败（读路径）**：该行占位（`[无法解密]` + `decrypt_failed`）+ Vercel 结构化 `console.error`（无明文/密钥）；不拖垮整页。UI 置灰批准/驳回/回复并显示原因。PATCH / 决定接口对 `decrypt_failed` 返回 **422**。
- **PATCH**：明文内容未变时保留原 `content_hash`（不重写 HMAC），避免仅改状态导致旧批准失效。
- **生产缺密钥**：`FIELD_ENCRYPTION_KEY*` 与 `CONTENT_HASH_KEY` 运行时 fail closed；`next build` 允许占位。
- **无 schema 迁移**：列类型仍为 `text`；合并**不会**改库结构。
- **item_events content_hash 重算**：`--rehash-only` 目前仅允许 dry-run——**待定，等阁主拍板**（本 PR 不加放开触发器的迁移）。

### 部署顺序（合并后由本人操作）

1. 在 Vercel 配置 `FIELD_ENCRYPTION_KEY`（或密钥环）与 `CONTENT_HASH_KEY`（**本 PR 不改 Vercel**）
2. 合并本 PR
3. `--encrypt-only --dry-run` → 审阅 → `--execute`
4. `--rehash-only`（仅 dry-run；execute 会拒绝，待事件表方案）
5. 确认无遗留明文后设置 `FIELD_ENCRYPTION_STRICT=1`

## 环境变量

| 变量 | 用途 |
|------|------|
| `SUPABASE_URL` | Supabase API URL（服务器） |
| `SUPABASE_SERVICE_ROLE_KEY` | service role；仅服务器；业务 DB |
| `SESSION_SECRET` | 会话 JWT HMAC；≥32 字节，不足则拒绝 |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` | Passkey RP 与 Origin 校验 |
| `SITE_NAME` | 登录页站名 |
| `FIELD_ENCRYPTION_KEY` | 字段加密主密钥（base64 32 字节）；或与 `FIELD_ENCRYPTION_KEY_Vn` / `FIELD_ENCRYPTION_KEYS` + `FIELD_ENCRYPTION_KEY_CURRENT` 组成密钥环 |
| `FIELD_ENCRYPTION_STRICT` | `1` 时拒绝遗留明文 / 无 AAD 密文 / 旧 SHA content_hash |
| `CONTENT_HASH_KEY` | content_hash HMAC 密钥（base64 32 字节；与字段加密密钥分离） |

已移除（应用不再读取；Vercel / Auth 侧可择机清理）：`BOOTSTRAP_TOKEN`、`OWNER_EMAIL`、`SUPABASE_ANON_KEY`（曾仅用于首次登记魔法链接 OTP）。

## 技术栈

Next.js App Router + TypeScript strict + Tailwind 占位 + Supabase JS + SimpleWebAuthn + Vitest 5 + GitHub Actions。
