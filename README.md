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
