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
| `webauthn_registration` | 单行：`open` **默认 false**；`one_time_token_hash`；`bootstrap_consumed_at`（首次登记成功时写入）；`consumed_setup_grant_jti`（setup-grant 单次消费） |
| `webauthn_challenges` | 短时 challenge；注册挑战带 `authorized=true` |
| `login_attempts` | 只按 IP 锁定；凭据 / 全站只告警；`auth_options` 限流计数 |
| `stale_items` | open 且 7 天无活动（`security_invoker`） |

全部表 RLS 开启，不给 anon/authenticated 策略。`item_events` 对 service_role 收回 UPDATE/DELETE/TRUNCATE。函数均 `SET search_path = public, pg_temp`。

种子：`supabase/seed.sql` 十二位姐妹占位。

## 注册与认证

1. **首次登记（魔法链接）**：`/setup` 收集邮箱 → `POST /api/auth/setup/request`。仅当邮箱与 `OWNER_EMAIL` 大小写不敏感匹配时，经 Supabase Auth `signInWithOtp`（`shouldCreateUser: false`）发信；**始终返回同一中性文案**，按 IP **进程内**限流，并对匹配/非匹配路径做 **~400ms** 最短响应时间填充（缩小时序差）。邮件链接落到 `/setup/confirm?token_hash=…&type=email`；**页面仅展示确认按钮，须 POST 后再 `verifyOtp`**（避免聊天/邮件预览消费 token）。校验通过后签发约 **10 分钟**、httpOnly、signed 的 `xjg_setup_grant` cookie（含 `aud` + `jti`）。
2. **WebAuthn 登记**：持有效 setup-grant 且库中**尚无任何凭据**时，`POST /api/auth/register/options` 以 `bootstrap` 模式创建 `authorized` 挑战；`verify` 成功写入凭据后**消费 jti**（写入 `consumed_setup_grant_jti`）并**清除 grant cookie**。同 jti 不可再用于登记。有凭据后 bootstrap 永久失效（fail closed）。`pubKeyCredParams` **仅** ES256 (`-7`) 与 RS256 (`-257`)，禁止 ML-DSA-44 (`-48`)。`residentKey` 仍为 `required`。
3. **中途失败恢复**：options 成功但 verify 失败且尚无凭据时，同一 setup-grant 在过期前可重试。complete RPC 对注册配置行 `FOR UPDATE`，成功后删除其余注册挑战。
4. **新设备**：已登录 + passkey → `POST /api/auth/register/invite`（一次性令牌，与首次登记无关）。
5. **登录**：会话 cookie 闲置 12h，绝对上限 7 天（`iat` 首次签发，滑动续期不改）；锁定逻辑集中 `evaluateLoginLockout`（只按 IP 锁 15 分钟；凭据与全站失败只告警——options 未登录可拿到凭据 ID，按凭据锁会被换 IP 锁死主人）。
6. **决定 step-up**：须带 `content_hash`；挑战抢占；`apply_item_decision` 事务条件更新；前端只见通用错误。

### 邮件 / OTP（SMTP 与过期）

| 项 | 现状 |
|----|------|
| SMTP | **当前**使用 Supabase 内置邮件（Auth 仪表盘 Email provider）；免费档**每小时发送上限较低**，仅够主人自用首次登记。**计划**后续换自定义 SMTP（Resend / 其它），本仓库暂不改 env。 |
| Magic link / OTP 过期 | **计划**在 Auth 仪表盘将 Email OTP / magic link 有效期设为 **15 分钟**（与 setup-grant ~10 分钟衔接：先点邮件再登记）。以仪表盘实际配置为准；Agent 不改远程 Auth 设置。 |

### Supabase Auth 仪表盘配置（合并后由本人操作；本 PR 不改远程配置）

| 项 | 要求 |
|----|------|
| Email provider | 开启（内置 mailer；见上表 SMTP） |
| 允许新用户注册 / signups | **关闭** |
| Site URL | `https://desk.nopaiseh.com` |
| Redirect URLs | 含 `https://desk.nopaiseh.com/**`（至少 `/setup/confirm`） |
| Magic Link 邮件模板 | 使用 `token_hash`，例如链到 `{{ .SiteURL }}/setup/confirm?token_hash={{ .TokenHash }}&type=email` |
| OTP / magic link 过期 | 计划 **15 分钟**（仪表盘配置） |
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
- **setup request/confirm 限流**：`src/lib/rate-limit.ts` 为**进程内** Map；多实例 / 冷启动各自计数且可重置，在 Serverless 下弱于全局限流。登录与 `register/options` 已走 DB；setup 路径本轮**仅文档化局限**，不加迁移（避免无谓 prod schema 变更）。若日后需强限流，再迁 Redis/库表或防火墙。

## 输入校验

- `source_url` 仅 https；`due_at` 为 ISO datetime；标题/正文/选项有长度与数量上限；选项 key 唯一；zod `.strict()`。
- WebAuthn `assertion` / `attestation` 的 `id`、`rawId` 最长 **1364** 字符（1023 字节凭据 ID 的无填充 base64url）；超长在进库前 400。属 body 校验失败，**不**计入 IP 登录失败锁定（与其它 zod 拒绝一致，避免垃圾超长请求被用来锁 IP）。

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

已移除：`BOOTSTRAP_TOKEN`（改由 `OWNER_EMAIL` + setup-grant 承担首次登记授权）。

## 技术栈

Next.js App Router + TypeScript strict + Tailwind 占位 + Supabase JS + SimpleWebAuthn + Vitest 5 + GitHub Actions。
