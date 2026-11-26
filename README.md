# 玄机阁 dashboard

desk.nopaiseh.com — 私人事务面板（待批、待办、问答、等别人、搁置、姐妹分栏、目标、每日小结）。

- 部署：Vercel 项目 `dashboard`（函数区新加坡 `sin1`）
- 数据：Supabase 项目 `ifirvlbeaookzhvvcdzs`
- 所有改动走 PR，经审查与本人批准后合并；不直接推送 main

## 开发

```bash
cp .env.example .env.local   # 填入本地密钥，勿提交
npm install
npm run dev
```

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

架构说明见 [docs/architecture.md](docs/architecture.md)。数据库迁移在 `supabase/migrations/`；种子在 `supabase/seed.sql`。

### 字段加密（本地）

`items` 的 `title` / `body` / `source_url` 经应用层 AES-256-GCM（AAD 绑定行/列）加密后入库；`content_hash` 为 HMAC-SHA256。本地在 `.env.local` 设置 `FIELD_ENCRYPTION_KEY` 与 `CONTENT_HASH_KEY`（均为 `openssl rand -base64 32`）。部署顺序与回填见 [docs/architecture.md](docs/architecture.md#字段加密)。

## 首次通行密钥登记（概要）

1. 配置 `OWNER_EMAIL`、`SESSION_SECRET`、`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`（anon 仅服务器 Auth OTP）。
2. 在 Supabase Auth 仪表盘：开启 Email、**关闭**公开注册、Site URL / Redirect 为 `https://desk.nopaiseh.com`，Magic Link 模板使用 `token_hash` 链到 `/setup/confirm`；预先创建与 `OWNER_EMAIL` 相同的用户。
3. 打开 `/setup` → 输入邮箱 → 邮件内链接 → **点击确认** → 登记 passkey（算法仅 ES256/RS256）。
