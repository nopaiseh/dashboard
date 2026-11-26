# 玄机阁架构说明

私人事务面板后端骨架。部署目标：Vercel（函数区 `sin1` / 新加坡），域名 `desk.nopaiseh.com`。数据库为独立 Supabase 项目 `ifirvlbeaookzhvvcdzs`。浏览器端不持有任何数据库密钥；全部数据访问经 Next.js Route Handlers 使用 **service role**。

> 注意：当前仓库**未**接入 Supabase GitHub 集成。合并 PR 后迁移**不会**自动上 prod，需人工在目标项目执行迁移。

## 表结构

| 对象 | 说明 |
|------|------|
| `agents` | 姐妹（slug / name / area / bot_id） |
| `agent_tokens` | Bearer 令牌 sha256；`revoked_at` 可作废重发 |
| `items` | 事项；`content_hash` = sha256(title+body+options) |
| `item_events` | 只增不改（禁止 UPDATE/DELETE/TRUNCATE）；决定记录 credential_id、verified_at、content_hash |
| `goals` / `daily_summaries` | 目标与每日小结 |
| `webauthn_credentials` | 本人 passkey |
| `webauthn_registration` | 单行：`open` **默认 false**；`one_time_token_hash`；`bootstrap_consumed_at` |
| `webauthn_challenges` | 短时 challenge；注册挑战带 `authorized=true` |
| `login_attempts` | IP / 全站锁定；`auth_options` 限流计数 |
| `stale_items` | open 且 7 天无活动（`security_invoker`） |

全部表 RLS 开启，不给 anon/authenticated 策略。`item_events` 对 service_role 收回 UPDATE/DELETE/TRUNCATE。函数均 `SET search_path = public, pg_temp`。

种子：`supabase/seed.sql` 十二位姐妹占位。

## 注册与认证

1. **首次登记**：必须带 `BOOTSTRAP_TOKEN`。要求至少 **32 字节**随机（不足视为未配置并拒绝）；生成示例：`openssl rand -base64 48`。比对：先各自 sha256，再用 `timingSafeEqual`（避免明文长度泄露）。`POST /api/auth/register/options` 无令牌 → 403。校验通过后 RPC **立即作废**启动令牌（写 `bootstrap_consumed_at`）并创建 `authorized` 挑战。**只要 `webauthn_credentials` 已有任何凭据，bootstrap 一律失效**（服务端与 RPC 事务内双重检查），不依赖人工删除环境变量。
2. **verify**：校验 attestation 后 RPC `complete_webauthn_registration` 在同一事务复查授权、写入凭据、关闭注册。
3. **新设备**：已登录 + 现场 passkey → `POST /api/auth/register/invite` 签发短时效一次性令牌（只回传一次明文，库内仅哈希）。之后用该令牌走 register/options（`one_time` 模式，options 时作废）。
4. **登录**：passkey → 会话 cookie `xjg_session`（httpOnly / Secure / SameSite=Strict，闲置 12h）。失败锁定逻辑集中在 `evaluateLoginLockout`（现状：IP+全站各 5 次 / 15 分钟；日后可改为 IP+凭据锁定）。
5. **决定 step-up**：`POST /api/auth/options`（purpose=step_up）→ `POST /api/items/:id/decision` 必须带 `content_hash`；挑战经 `claim_webauthn_challenge` 抢占，`item_id` 严格相等；状态+事件由 `apply_item_decision` 同一事务条件更新。

## 姐妹接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/items` | 新建 |
| PATCH | `/api/agent/items/:id` | 仅自己名下；状态只许 `done`/`withdrawn`；改标题/正文/选项 → 退回 `open`、重算 hash、记事件；有本人决定后禁止改 `kind` |
| GET | `/api/agent/inbox?since=` | 已决定事项 + 流水；`invalidated` 表示内容事后变更 |

## 本人读接口

`GET /api/items`、`/api/goals`、`/api/summaries`（需登录）。决定无批量接口。

## 防护

- `src/proxy.ts`：缺 `SESSION_SECRET` 一律拒绝；静态资源仅 `public/` 白名单；未登录页 → `/login`，API → 401。
- `(protected)/layout` 服务器端再验会话。
- Cookie 写操作校验 `Origin === WEBAUTHN_ORIGIN`。
- 未登录 options：库内 `rate_limit_auth_options` 限流并清理过期挑战。
- 安全头：CSP、HSTS、`frame-ancestors 'none'`、`Referrer-Policy: no-referrer`、`X-Robots-Tag`；robots.txt 全站 disallow。
- 服务端模块 `import "server-only"`。

## 输入校验

- `source_url` 仅 https；`due_at` 为 ISO datetime；标题/正文/选项有长度与数量上限；选项 key 唯一；zod `.strict()`。

## 环境变量

| 变量 | 用途 |
|------|------|
| `SUPABASE_URL` | Supabase API URL（服务器） |
| `SUPABASE_SERVICE_ROLE_KEY` | service role；仅服务器 |
| `SESSION_SECRET` | 会话 JWT HMAC；缺失则拒绝所有鉴权 |
| `BOOTSTRAP_TOKEN` | 首次注册启动令牌（≥32 字节；`openssl rand -base64 48`）；先哈希再恒定时间比对；有凭据后自动失效；用后作废 |
| `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` | Passkey RP 与 Origin 校验 |
| `SITE_NAME` | 登录页站名 |

## 技术栈

Next.js App Router + TypeScript strict + Tailwind 占位 + Supabase JS + SimpleWebAuthn + Vitest 5 + GitHub Actions。
