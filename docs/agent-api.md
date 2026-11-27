# 姐妹 Agent API 说明

域名：`https://desk.nopaiseh.com`  
鉴权：所有者签发的 Bearer 令牌（`Authorization: Bearer <token>`）。  
令牌由阁主在 `/settings/agents` 签发；**明文只出现一次**，请立刻写入自己的保密环境变量。

## 安全规矩

1. 令牌只存在于你自己的保密环境变量（或密钥库），**绝不**写入聊天、日志、截图、工单、公开仓库。
2. 请求一律走 HTTPS；不要把令牌放进 URL 查询串。
3. 疑似泄露：立刻请所有者在 `/settings/agents` 吊销，再发新令牌。
4. 服务端密钥（如 `SUPABASE_SERVICE_ROLE_KEY`）从不离开 Vercel；姐妹侧拿不到、也不需要。

## 鉴权头

```http
Authorization: Bearer xjg_at_…
```

- 前缀 `xjg_at_` 为固定可识别前缀。
- 无效、缺失或已吊销 → `401`。
- 限流（按令牌哈希，进程内）：约 **60 次 / 分钟**；超限 → `429`（可能带 `retryAfterSeconds`）。生产另有 Vercel 防火墙兜底。

## 字段约定（以代码为准）

| 字段 | 说明 |
|------|------|
| `kind` | `approval`（待批）/ `todo`（待办）/ `question_to_user`（问你的）/ `question_from_user`（你问的）/ `waiting`（等别人） |
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

问答（问阁主）/ 等别人：

```bash
# question_to_user — 问阁主
curl -sS -X POST 'https://desk.nopaiseh.com/api/agent/items' \
  -H 'Authorization: Bearer '"$SISTER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"question_to_user","title":"行程是否改期？","body":"原定周五"}'

# waiting — 等别人
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

## 错误码速查

| 状态 | 含义 |
|------|------|
| 400 | 参数 / body 不合法 |
| 401 | 缺令牌、无效或已吊销 |
| 403 | 越权（如改他人事项） |
| 404 | 资源不存在 |
| 409 | 冲突（并发 / 条件不满足） |
| 422 | 敏感字段解密失败 |
| 429 | 限流 |
| 500 | 服务端错误（文案不含内部细节） |

## 令牌生命周期（所有者）

- 签发 / 吊销：`/settings/agents`（每次操作重新验通行密钥）。
- 库中只存 SHA-256 哈希；吊销写 `revoked_at`，不删行；吊销后立即 `401`。
- 默认发新令牌时勾选「同时吊销旧令牌」。
