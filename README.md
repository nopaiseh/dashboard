# 玄机阁 dashboard

desk.nopaiseh.com — 私人事务面板（待批、待办、待回音、搁置、姐妹分栏、每日小结）。

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

`items` 的 `title` / `body` / `source_url`，以及 `dashboard_blocks.payload`，经应用层 AES-256-GCM（AAD 绑定行/列）加密后入库；`content_hash` 为 HMAC-SHA256。本地在 `.env.local` 设置 `FIELD_ENCRYPTION_KEY` 与 `CONTENT_HASH_KEY`（均为 `openssl rand -base64 32`）。回填分 `--encrypt-only` / `--rehash-only`（默认 dry-run）。部署顺序见 [docs/architecture.md](docs/architecture.md#字段加密)。

## 通行密钥

首次登记（魔法链接 / `/setup`）已关闭。登录走 `/login` 通行密钥。新设备登记走已登录 + passkey 签发的 invite 一次性令牌（`POST /api/auth/register/invite`）；目前无专用 UI，见 [docs/architecture.md](docs/architecture.md)。
