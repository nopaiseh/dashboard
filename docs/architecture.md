# 玄机阁架构说明

私人事务面板后端骨架。部署目标：Vercel（函数区 `sin1` / 新加坡），域名 `desk.nopaiseh.com`。数据库为独立 Supabase 项目 `ifirvlbeaookzhvvcdzs`。浏览器端不持有任何数据库密钥；全部数据访问经 Next.js Route Handlers 使用 **service role**。

> 注意：当前仓库**未**接入 Supabase GitHub 集成。合并 PR 后迁移**不会**自动上 prod，需人工在目标项目执行 `supabase db push` / 控制台跑 SQL。

## 表结构

| 对象 | 说明 |
|------|------|
| `agents` | 姐妹（slug / name / area / bot_id） |
| `agent_tokens` | Bearer 令牌的 sha256 哈希；`revoked_at` 非空即作废，可重发 |
| `items` | 待批 / 待办 / 问答 / 等待等事项；`content_hash` = sha256(title+body+options) |
| `item_events` | 只增不改（触发器禁止 UPDATE/DELETE）；记录决定时的 credential_id、verified_at、content_hash |
| `goals` | 目标与进度 |
| `daily_summaries` | 每日小结（`date` 主键） |
| `webauthn_credentials` | 本人 passkey；可多设备 |
| `webauthn_registration` | 单行配置：`open` 首次开放；关闭后加设备需一次性令牌哈希 |
| `webauthn_challenges` | 短时 challenge（login / register / step_up） |
| `login_attempts` | 按 `ip` 与 `global` 计数；连续失败 5 次锁 15 分钟 |
| `stale_items` | 视图：`status='open'` 且 `last_activity_at < now()-7 days`（`security_invoker`） |

全部表启用 **RLS**，且**不**为 `anon` / `authenticated` 创建任何策略；并 `REVOKE ALL`。唯一访问路径是服务端 service role。

种子：`supabase/seed.sql` 写入十二位姐妹占位（名称可为 TODO）。

## 接口

### 姐妹（`Authorization: Bearer <token>`，哈希比对 + 内存限流）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/agent/items` | 新建事项，写 `create` 事件 |
| PATCH | `/api/agent/items/:id` | 仅可改自己名下；不可把 status 设为 `approved`/`rejected`；改内容重算 `content_hash` |
| GET | `/api/agent/inbox?since=` | 拉取自己名下已有决定的事项及决定流水（含 credential_id、verified_at、content_hash）；`invalidated` 表示内容事后被改 |

结果只拉取，不做推送。

### 本人（passkey + httpOnly 会话）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/options` | 登录断言选项 |
| POST | `/api/auth/verify` | 校验断言，签发会话 cookie |
| POST | `/api/auth/options` | `{ purpose:'step_up', item_id }` 逐步提升断言选项（需已登录） |
| POST | `/api/items/:id/decision` | 必须携带新的 passkey 断言；写 `item_events` 并更新 status；**无批量接口** |
| POST | `/api/auth/register/options` | 首次 `open=true`；之后需一次性登记令牌 |
| POST | `/api/auth/register/verify` | 写入凭证并关闭开放登记 |
| POST | `/api/auth/logout` | 清除会话 |

会话 cookie：`xjg_session`，`httpOnly` + `Secure` + `SameSite=Strict`，闲置 12 小时过期（滑动刷新）。

### 读接口（需登录）

| 方法 | 路径 |
|------|------|
| GET | `/api/items?kind=&agent=&status=` |
| GET | `/api/goals` |
| GET | `/api/summaries` |

## 认证与核对流程

1. **姐妹令牌**：明文只在发放时出现一次；库内仅存 sha256。请求带 `Authorization: Bearer`，服务端哈希后查 `agent_tokens`（未作废）。
2. **本人登录**：WebAuthn 断言 → 校验 → JWT 会话 cookie。失败计入 `login_attempts`（IP + 全站）；连续 5 次锁 15 分钟。
3. **逐步提升决定**：对单条事项先取 step-up options，再 `POST .../decision` 提交断言。校验通过后写入事件：`credential_id`、`verified_at`、当时的 `content_hash`。
4. **核对 / 失效**：若事项事后被姐妹修改，`content_hash` 变化；inbox 中该决定标注 `invalidated: true`，批准视为失效。姐妹侧靠拉取 inbox 发现。

## 防护

- `src/proxy.ts`：未登录访问页面 → `/login`；未登录访问受保护 API → `401`。姐妹 API 与登录/登记 API 放行。
- 全站响应头 `X-Robots-Tag: noindex, nofollow`；`robots.txt` 禁止全部；页面 `metadata.robots` noindex。
- 登录页只展示站名（`SITE_NAME` / 玄机阁）。

## 环境变量（见 `.env.example`）

| 变量 | 用途 |
|------|------|
| `SUPABASE_URL` | Supabase API URL（服务器） |
| `SUPABASE_SERVICE_ROLE_KEY` | service role 密钥；**仅服务器**，绝不下发浏览器 |
| `SESSION_SECRET` | 会话 JWT HMAC 密钥 |
| `WEBAUTHN_RP_ID` | Passkey RP ID（默认 `desk.nopaiseh.com`） |
| `WEBAUTHN_RP_NAME` | RP 显示名 |
| `WEBAUTHN_ORIGIN` | 期望 Origin（默认 `https://desk.nopaiseh.com`） |
| `SITE_NAME` | 登录页站名 |

本地开发将 `.env.example` 复制为 `.env.local` 并填入真实值（勿提交）。

## 技术栈

Next.js App Router（TypeScript strict）+ Tailwind（占位页）+ Supabase JS（service role）+ SimpleWebAuthn + Vitest + GitHub Actions（lint / typecheck / test / build）。
