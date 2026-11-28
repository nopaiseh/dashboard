# 姐妹 Agent API 说明

域名：`https://desk.nopaiseh.com`  
鉴权：所有者签发的 Bearer 令牌（`Authorization: Bearer <token>`）。  
令牌由阁主在专员详情页「令牌」标签（`/agents/[id]?tab=tokens`）签发；**明文只出现一次**，请立刻写入自己的保密环境变量。

## 安全规矩

1. 令牌只存在于你自己的保密环境变量（或密钥库），**绝不**写入聊天、日志、截图、工单、公开仓库。
2. 请求一律走 HTTPS；不要把令牌放进 URL 查询串。
3. 疑似泄露：立刻请所有者在专员详情页「令牌」标签（`/agents/[id]?tab=tokens`）吊销，再发新令牌。
4. 服务端密钥（如 `SUPABASE_SERVICE_ROLE_KEY`）从不离开 Vercel；姐妹侧拿不到、也不需要。

## 鉴权头

```http
Authorization: Bearer xjg_at_…
```

- 前缀 `xjg_at_` 为固定可识别前缀。
- 缺失 Bearer → `401`（不查库、不限流）。
- 无效 / 未知 / 已吊销 → 共享桶 `agent:invalid`（**60/分** + **1000/日**，全站共用）；未超限 → `401`，超限 → `429`。
- 进程内预检：本实例对 `agent:invalid` 另有内存计数（阈值与库表分钟桶相同）。查令牌表前若内存桶已超限 → 直接 `429`（不查表、不调 RPC）。本实例近期校验通过的哈希（仅存哈希，约 100 条 / 10 分钟 TTL）可跳过该预检，但仍走查表、吊销校验与按令牌限流，避免无效令牌洪泛锁死合法写入。
- 有效令牌限流（`agent:` + SHA-256 哈希，**跨实例**库表）：**60 次 / 分钟** 且 **1000 次 / 天**；超限 → `429`（`Retry-After` 头 + body `retryAfterSeconds`）。
- RPC 出错或约 1.5s 超时回退进程内限流；生产另有 Vercel 防火墙兜底。

## 字段约定（以代码为准）

| 字段 | 说明 |
|------|------|
| `kind` | `approval`（待批）/ `todo`（待办）/ `waiting`（待回音）。已移除的 `question_to_user` / `question_from_user` 会返回 `400` |
| `title` | 必填，≤200 |
| `body` | 可选，≤10000 |
| `project` | 可选，≤200 |
| `options` | 可选；最多 20；每项 `{ "key", "label" }`；key 唯一 |
| `due_at` | 可选；ISO datetime 或 `null` |
| `source_url` | 可选；**仅 https** 或 `null` |
| `status`（PATCH） | 姐妹仅可设 `done` / `withdrawn`；`approval` 且仍为 `open` 时只能 `withdrawn` |

校验失败统一 `400`（`invalid body` / `invalid query`）。敏感字段在库内加密；接口仍收发明文。

---

## POST `/api/agent/items` — 新建

```bash
curl -sS -X POST 'https://desk.nopaiseh.com/api/agent/items' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "kind": "approval",
    "title": "是否采购新显示器",
    "body": "预算约 2k，链接见 source_url",
    "project": "工位",
    "options": [
      { "key": "yes", "label": "批准" },
      { "key": "no", "label": "驳回" }
    ],
    "source_url": "https://example.com/product",
    "due_at": null
  }'
```

待办：

```bash
curl -sS -X POST 'https://desk.nopaiseh.com/api/agent/items' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "kind": "todo",
    "title": "整理本周纪要",
    "body": "周五前",
    "due_at": "2026-12-01T10:00:00.000Z"
  }'
```

待回音：

```bash
curl -sS -X POST 'https://desk.nopaiseh.com/api/agent/items' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"waiting","title":"等财务回函","body":"已催一次"}'
```

成功：`201`，body 含 `item`。

---

## PATCH `/api/agent/items/:id` — 更新

仅可改自己名下事项。改内容会把已决定事项退回 `open`；有本人决定后禁止改 `kind`。  
**不可**同时传内容字段与 `status: "withdrawn"`（`400`）。

```bash
curl -sS -X PATCH 'https://desk.nopaiseh.com/api/agent/items/ITEM_UUID' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"更新后的标题","body":"补充说明"}'
```

标完成 / 撤回：

```bash
curl -sS -X PATCH 'https://desk.nopaiseh.com/api/agent/items/ITEM_UUID' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'

# open 的 approval 只能 withdrawn
curl -sS -X PATCH 'https://desk.nopaiseh.com/api/agent/items/ITEM_UUID' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"withdrawn"}'
```

常见错误：`403` 非己事项；`409` 冲突；`404` 不存在；`422` 字段无法解密。

---

## GET `/api/agent/inbox` — 拉取已决定事项

```bash
curl -sS 'https://desk.nopaiseh.com/api/agent/inbox' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN"

# 增量
curl -sS 'https://desk.nopaiseh.com/api/agent/inbox?since=2026-11-01T00:00:00.000Z' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN"
```

返回该姐妹非 `open` 且已有最终决定的事项，以及相关决定流水；`invalidated` 表示内容事后变更、原决定失效。

---

## POST `/api/agent/items/:id/result-read` — 标已读

阁主决定后，姐妹确认已读（写入 `result_read_at`）：

```bash
curl -sS -X POST 'https://desk.nopaiseh.com/api/agent/items/ITEM_UUID/result-read' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN"
```

---

---

## Dashboard 区块（目标页并入后的通用数据层）

明文只允许：`category`、`block_type`、`sort_order`、拥有姐妹 `agent_id`、可选明文 `block_key`、时间戳。  
标题 / 数值 / 正文 / 一行标题 / 列表等内容一律进加密 `payload`（与 items 相同的 AES-256-GCM 信封 `v{N}:…`；AAD=`dashboard_blocks:{id}:payload:v{N}`；无遗留明文）。  
**无 DELETE**：只提供 POST/PATCH/PUT（按 key upsert）；写入经 RPC 与 `dashboard_block_events` 同事务。  
**看板写入人**：每个 `category` 在 `dashboard_writers` 指定一位 `writer_agent_id`。agent 对该分类的一切写操作（建分区、建/改/upsert block）仅当令牌所属 agent 等于该写入人时允许；**未指定写入人 → 一律 403**。写入人只能由 owner 在登录后设置/修改（`PUT /api/owner/dashboard/writers`，session + passkey step-up）；agent 不能改。令牌本身不再带分类白名单。  
返回解密 body 的响应带 `Cache-Control: no-store`。更改 `block_type` 时必须同时提交符合新类型的 `payload`，否则 `400`。

### `block_key` 按分区白名单

- `category` 规范化后为 `bank`：只接受 `BANK_BLOCK_KEYS`（见 `src/lib/bank-block-keys.ts`，28 个，如 `bank_conclusion`、`bank_acc_hsbc`、`bank_prog_emergency`、`bank_net`、`bank_ledger`、`bank_todos`…）。银行区块另走严格 zod（金额 number、`unit` 固定 `"S$"`、等式校验等）。
- `category` 为 `cpf`：只接受 `CPF_BLOCK_KEYS`。
- 其他分类：维持原状（若带 `block_key` 仍按 CPF 白名单）。
- 交叉写入（CPF key → bank 分区，或反之）→ `400`（`invalid payload`，不回显命中内容）。

明文列 `dashboard_blocks.block_key` + 唯一索引 `(section_id, block_key) WHERE block_key IS NOT NULL`（本迁移新增）用于 upsert 原子性；加密 payload 内仍镜像同一 key。

### POST `/api/agent/dashboard/sections` — 新建分区

```bash
curl -sS -X POST 'https://desk.nopaiseh.com/api/agent/dashboard/sections' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"category":"cpf","sort_order":0}'
```

成功：`201`，body 含 `section`（`agent_id` 固定为令牌所属姐妹）。非该分类写入人 / 未指定写入人 → `403`。

### PATCH `/api/agent/dashboard/sections/:id` — 更新分区

可改 `category` / `sort_order`。须为当前分类写入人；改 `category` 时亦须为目标分类写入人。否则 → `403`。

### POST `/api/agent/dashboard/blocks` — 新建区块

`block_type`：`headline` | `metric` | `progress` | `list` | `text` | `chart_series`。  
`payload` 按类型 + 分区分类校验（接口收明文，入库前加密）。须为该分区 `category` 的写入人。

可选字段 `payload.block_key`：须属于该分区 category 的白名单（见上）。未知值、分区不匹配或非字符串 → `400`（`invalid payload`）。同一 `section_id` 下每个 `block_key` 至多属于一个区块；POST 重复，或 PATCH 改到已被占用的 key → `409`（`conflict`，不回显 payload）。PATCH 保留本块自己的 key 允许。**改 payload 时要把 `block_key` 一起带上，否则原 key 会丢失**（整份 payload 替换，未写的字段不会保留）。

```bash
curl -sS -X POST 'https://desk.nopaiseh.com/api/agent/dashboard/blocks' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "section_id": "SECTION_UUID",
    "block_type": "headline",
    "sort_order": 0,
    "payload": { "text": "今天重点：把 CPF 投影对上。" }
  }'
```

进度块示例：

```bash
curl -sS -X POST 'https://desk.nopaiseh.com/api/agent/dashboard/blocks' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "section_id": "SECTION_UUID",
    "block_type": "progress",
    "payload": {
      "title": "OA 余额",
      "target": "100k",
      "metric": "SGD",
      "progress": 0.55,
      "due_at": null,
      "status": "active"
    }
  }'
```

成功：`201`，body 含解密后的 `block`。

### PATCH `/api/agent/dashboard/blocks/:id` — 更新区块

须为该区块所属分区分类的写入人。可传 `block_type` / `sort_order` / `payload`。无 DELETE。  
改 `payload` 时要把 `block_key` 一起带上，否则原 key 会丢失。

### PUT `/api/agent/dashboard/sections/:id/blocks/:block_key` — 按 key upsert

存在则整份替换 `payload`（及 `block_type` / `sort_order`），不存在则创建。路径上的 `block_key` 必须属于该分区白名单；`payload.block_key` 若出现须与路径一致（可省略，由服务端注入）。鉴权（看板写入人）、校验、限流与 POST/PATCH 相同。成功：新建 `201`，替换 `200`。

```bash
curl -sS -X PUT 'https://desk.nopaiseh.com/api/agent/dashboard/sections/SECTION_UUID/blocks/bank_acc_hsbc' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "block_type": "metric",
    "payload": {
      "block_key": "bank_acc_hsbc",
      "title": "FAKE HSBC",
      "role_tag": "薪资",
      "group": "hub",
      "value": 0,
      "label": "FAKE",
      "unit": "S$"
    }
  }'
```

### 所有者读取

登录后 `GET /api/dashboard`：返回 `headline`（无一行标题块时为 `""`，前端可回退默认文案）与 `sections[].blocks`（已解密）。**银行分区与 CPF 相同**：仅所有者会话可读，经 `(protected)` 布局 + `requireSession` / 通行密钥登录保护；agent Bearer **不能**读 dashboard。

---

## 错误码速查

| 状态 | 含义 |
|------|------|
| 400 | 参数 / body 不合法 |
| 401 | 缺令牌、无效或已吊销 |
| 403 | 越权（如改他人事项 / 非看板写入人 / 未指定写入人） |
| 404 | 资源不存在 |
| 409 | 冲突（并发 / 条件不满足） |
| 422 | 敏感字段解密失败 |
| 429 | 限流 |
| 500 | 服务端错误（文案不含内部细节） |

## 令牌生命周期（所有者）

- 签发 / 吊销：专员详情页「令牌」标签（`/agents/[id]?tab=tokens`）（每次操作重新验通行密钥）。令牌**不**附带分类白名单。
- 签发 `POST /api/owner/agents/:id/tokens`：通行密钥 step-up；库中只存 SHA-256 哈希。
- 吊销写 `revoked_at`，不删行；吊销后立即 `401`。默认发新令牌时勾选「同时吊销旧令牌」。

## 看板写入人（所有者）

- `GET /api/owner/dashboard/writers`：列出 `category → writer_agent_id`（须登录会话）。
- `PUT /api/owner/dashboard/writers`：指定/修改写入人；body 含 `category`、`writer_agent_id` + 通行密钥 step-up（`action=set_dashboard_writer`）。
- 迁移回填：每个分类若恰有一个 agent 拥有该分类分区 → 设为写入人；`bank` 回填为与 `cpf` 相同的写入人；多 agent 共有同一分类 → **不回填**（须 owner 手工指定）。不硬编码任何 agent id。
