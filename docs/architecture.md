# 玄机阁架构说明

私人事务面板后端骨架。部署目标：Vercel（函数区 `sin1` / 新加坡），域名 `desk.nopaiseh.com`。数据库为独立 Supabase 项目 `ifirvlbeaookzhvvcdzs`。浏览器端不持有任何数据库密钥；全部数据访问经 Next.js Route Handlers 使用 **service role**。

> 注意：本仓库已开 Supabase「Deploy to production」（分支 `main`）。合并到 `main` 后迁移会自动上 prod。

## 表结构

| 对象 | 说明 |
|------|------|
| `agents` | 姐妹（slug / name / area / bot_id） |
| `agent_tokens` | Bearer 令牌 sha256；`revoked_at` 可作废重发 |
| `items` | 事项；`content_hash` = sha256(JSON.stringify([kind, title, body, options, source_url, normalize(due_at)]))；`due_at` 比对前统一 `toISOString()` |
| `item_events` | 只增不改（禁止 UPDATE/DELETE/TRUNCATE）；决定记录 credential_id、verified_at、content_hash |
| `goals` / `daily_summaries` | 目标与每日小结 |
| `webauthn_credentials` | 本人 passkey |
| `webauthn_registration` | 单行：`open` **默认 false**；`one_time_token_hash`；`bootstrap_consumed_at`（首次登记成功时写入） |
| `webauthn_challenges` | 短时 challenge；注册挑战带 `authorized=true` |
| `login_attempts` | 只按 IP 锁定；凭据 / 全站只告警；`auth_options` 限流计数 |
| `stale_items` | open 且 7 天无活动（`security_invoker`） |

全部表 RLS 开启，不给 anon/authenticated 策略。`item_events` 对 service_role 收回 UPDATE/DELETE/TRUNCATE。函数均 `SET search_path = public, pg_temp`。

种子：`supabase/seed.sql` 十二位姐妹占位。

## 注册与认证

1. **首次登记（魔法链接）**：`/setup` 收集邮箱 → `POST /api/auth/setup/request`。仅当邮箱与 `OWNER_EMAIL` 大小写不敏感匹配时，经 Supabase Auth `signInWithOtp`（`shouldCreateUser: false`）发信；**始终返回同一中性文案**，并按 IP 限流。邮件链接落到 `/setup/confirm?token_hash=…&type=email`；**页面仅展示确认按钮，须 POST 后再 `verifyOtp`**（避免聊天/邮件预览消费 token）。校验通过后签发约 **10 分钟**、httpOnly、signed 的 `xjg_setup_grant` cookie。
2. **WebAuthn 登记**：持有效 setup-grant 且库中**尚无任何凭据**时，`POST /api/auth/register/options` 以 `bootstrap` 模式创建 `authorized` 挑战；`verify` 成功写入凭据后**清除 grant**。有凭据后 bootstrap 永久失效（fail closed）。`pubKeyCredParams` **仅** ES256 (`-7`) 与 RS256 (`-257`)，禁止 ML-DSA-44 (`-48`)。`residentKey` 仍为 `required`。
3. **中途失败恢复**：options 成功但 verify 失败且尚无凭据时，同一 setup-grant 在过期前可重试。complete RPC 对注册配置行 `FOR UPDATE`，成功后删除其余注册挑战。
4. **新设备**：已登录 + passkey → `POST /api/auth/register/invite`（一次性令牌，与首次登记无关）。
5. **登录**：会话 cookie 闲置 12h，绝对上限 7 天（`iat` 首次签发，滑动续期不改）；锁定逻辑集中 `evaluateLoginLockout`（只按 IP 锁 15 分钟；凭据与全站失败只告警——options 未登录可拿到凭据 ID，按凭据锁会被换 IP 锁死主人）。
6. **决定 step-up**：须带 `content_hash`；挑战抢占；`apply_item_decision` 事务条件更新；前端只见通用错误。

### Supabase Auth 仪表盘配置（合并后由本人操作；本 PR 不改远程配置）

| 项 | 要求 |
|----|------|
| Email provider | 开启 |
| 允许新用户注册 / signups | **关闭** |
| Site URL | `https://desk.nopaiseh.com` |
| Redirect URLs | 含 `https://desk.nopaiseh.com/**`（至少 `/setup/confirm`） |
| Magic Link 邮件模板 | 使用 `token_hash`，例如链到 `{{ .SiteURL }}/setup/confirm?token_hash={{ .TokenHash }}&type=email` |
| 用户 | 预先在 Auth 中创建与 `OWNER_EMAIL` 相同的用户（因 `shouldCreateUser: false` + 禁止注册） |

## 姐妹接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/items` | 新建 |
| PATCH | `/api/agent/items/:id` | RPC `apply_agent_item_patch` 单事务 FOR UPDATE；不回写旧 status；冲突 `SQLSTATE XJ409`→409；approval 且 open 时只能 `withdrawn`；改内容 → 退回 open；**内容字段与 `status: withdrawn` 同时传入 → 400**；有本人决定后禁改 kind |
| GET | `/api/agent/inbox?since=` | 已决定事项 + 流水；`invalidated` 表示内容事后变更 |

## 本人读接口

`GET /api/items`、`/api/goals`、`/api/summaries`（需登录）。决定无批量接口。

## 防护

- `src/proxy.ts`：`SESSION_SECRET` 缺失或短于 32 字节一律拒绝；静态资源白名单；未登录 → `/login` 或 401；**会话滑动续期在此写 cookie**（页面内不可 `cookies().set`）。
- CSP：proxy 每请求生成 nonce，`script-src 'self' 'nonce-…' 'strict-dynamic'`（生产无 unsafe-inline/unsafe-eval），经 `x-nonce` 交给 Next。受保护页 / `not-found` / 登录等**全动态**（先 `connection()`/`cookies()` 再判密钥），避免无密钥构建固化跳转；页面不用 `style={{}}`。
- `(protected)/layout` 再验会话（只校验，不续期）。
- Cookie 写操作校验 Origin；登录/注册 options 库内限流；登录失败计数经 `record_login_failure_atomic` 原子 upsert（读锁定状态或 RPC 失败则 fail closed；`locked` 时 verify 返回 429）。
- RPC：`REVOKE EXECUTE FROM public, anon, authenticated`，仅 `service_role`；冲突/禁止/未找到用自定义 SQLSTATE `XJ409` / `XJ403` / `XJ404`。
- 安全头：HSTS、`frame-ancestors 'none'`、`Referrer-Policy: no-referrer`、`X-Robots-Tag`。
- **上线后**：姐妹接口内存限流由 **Vercel 防火墙规则**兜底（本仓库暂不改内存限流实现）。

## 输入校验

- `source_url` 仅 https；`due_at` 为 ISO datetime；标题/正文/选项有长度与数量上限；选项 key 唯一；zod `.strict()`。
- WebAuthn `assertion` / `attestation` 的 `id`、`rawId` 最长 **1364** 字符（1023 字节凭据 ID 的无填充 base64url）；超长在进库前 400。属 body 校验失败，**不**计入 IP 登录失败锁定（与其它 zod 拒绝一致，避免垃圾超长请求被用来锁 IP）。

## 字段加密

`items.title`、`items.body`、`items.source_url` 在写入 Supabase 前于服务器用 **AES-256-GCM** 加密，读出后再解密。实现：`src/lib/crypto/fields.ts`（`server-only`）/ `fields-core.ts`。

- **信封格式**：`v{N}:{iv_b64}:{tag_b64}:{ciphertext_b64}`（每值随机 12 字节 IV；GCM tag；密文段可为**空**——空字符串 `body`）。
- **AAD**：`items:{id}:{column}:v{N}`，防止跨行/跨列调换密文。新建事项时在应用层 `randomUUID()` 预生成 `id` 再加密后插入。
- **content_hash**：`HMAC-SHA256(CONTENT_HASH_KEY, JSON.stringify([kind, title, body, options, source_url, due_at]))`（密钥与字段加密分离）。过渡期 `matchesStoredContentHash` 仍接受旧版纯 SHA-256，避免 PATCH/决定误判；`FIELD_ENCRYPTION_STRICT=1` 后只接受 HMAC。
- **遗留明文**：非严格模式下无信封则原样返回。回填 `scripts/encrypt-existing-fields.ts`（默认 `--dry-run`）须指定 `--encrypt-only` 或 `--rehash-only`；CAS；幂等。**切勿未审阅对生产执行。**
- **密钥环**：`FIELD_ENCRYPTION_KEY` / `FIELD_ENCRYPTION_KEY_Vn` / `FIELD_ENCRYPTION_KEYS` + `FIELD_ENCRYPTION_KEY_CURRENT`；`KEY` 与 `KEY_V1` 同时设置且值不同 → 报错。密钥须严格 base64、恰好 32 字节。配置错误一律抛出，不吞掉。
- **单行解密失败（读路径）**：该行占位（`[无法解密]` + `decrypt_failed`）+ Vercel 结构化 `console.error`（无明文/密钥）；不拖垮整页。PATCH / 决定接口对 `decrypt_failed` 返回 **422**。
- **PATCH**：明文内容未变时保留原 `content_hash`（不重写 HMAC），避免仅改状态导致旧批准失效。
- **生产缺密钥**：`FIELD_ENCRYPTION_KEY*` 与 `CONTENT_HASH_KEY` 运行时 fail closed；`next build` 允许占位。
- **无 schema 迁移**：列类型仍为 `text`；合并**不会**改库结构。
- **item_events content_hash 重算**：`--rehash-only` 会尝试改写事件表，但表有只追加触发器——**待定，等阁主拍板**（本 PR 不加放开触发器的迁移）。

### 部署顺序（合并后由本人操作）

1. 在 Vercel 配置 `FIELD_ENCRYPTION_KEY`（或密钥环）与 `CONTENT_HASH_KEY`（**本 PR 不改 Vercel**）
2. 合并本 PR
3. `--encrypt-only --dry-run` → 审阅 → `--execute`
4. `--rehash-only --dry-run` → 审阅 → `--execute`（事件表改写待定）
5. 确认无遗留明文后设置 `FIELD_ENCRYPTION_STRICT=1`

## 环境变量

| 变量 | 用途 |
|------|------|
| `SUPABASE_URL` | Supabase API URL（服务器） |
| `SUPABASE_SERVICE_ROLE_KEY` | service role；仅服务器；业务 DB |
| `SUPABASE_ANON_KEY` | 仅 Auth OTP（`signInWithOtp` / `verifyOtp`）；服务器专用，勿用 `NEXT_PUBLIC_` |
| `SESSION_SECRET` | 会话 JWT 与 setup-grant HMAC；≥32 字节，不足则拒绝 |
| `OWNER_EMAIL` | 唯一允许首次登记魔法链接的邮箱；服务器专用 |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` | Passkey RP 与 Origin 校验 |
| `SITE_NAME` | 登录页站名 |
| `FIELD_ENCRYPTION_KEY` | 字段加密主密钥（base64 32 字节）；或与 `FIELD_ENCRYPTION_KEY_Vn` / `FIELD_ENCRYPTION_KEYS` + `FIELD_ENCRYPTION_KEY_CURRENT` 组成密钥环 |
| `FIELD_ENCRYPTION_STRICT` | `1` 时拒绝遗留明文 / 无 AAD 密文 / 旧 SHA content_hash |
| `CONTENT_HASH_KEY` | content_hash HMAC 密钥（base64 32 字节；与字段加密密钥分离） |

已移除：`BOOTSTRAP_TOKEN`（改由 `OWNER_EMAIL` + setup-grant 承担首次登记授权）。

## 技术栈

Next.js App Router + TypeScript strict + Tailwind 占位 + Supabase JS + SimpleWebAuthn + Vitest 5 + GitHub Actions。
