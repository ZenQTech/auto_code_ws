# 自动对话名称生成 Spec

> **⚠️ SUPERSEDED by `simplify-session-title-display`** — 此 spec 已被撤销（2026-06-23），AI 自动命名方案被纯前端截取显示取代。本 spec 仅作为历史记录保留。

## Why
当前 `Session.title` 默认采用"截取首条用户消息前 30 字"的简单策略（见 `conversation-history-sidebar` spec），但用户消息常常是"你好"、"在吗"等无意义短句或省略号，截取后侧边栏展示效果差，用户无法快速辨识历史对话的主题。需要让 Hermes 在用户**首次发送需求并收到回复后**，对整段对话进行语义总结，生成一个简洁（6-16 字）、描述任务意图的对话名称，**更新到 Session.title**，作为侧边栏的核心标识。该自动总结**只在第一次**对话完成后触发，避免后续对话中重复消耗 LLM token。

## What Changes
- 引入"对话总结生成"流程：首次 Hermes 流式回复 done 后，调用 Hermes（短 prompt + 用户消息 + Hermes 回复）生成 6-16 字中文任务标题
- 后端新增 `POST /api/sessions/{id}/auto-title` 端点：接受 user_message + assistant_message（必须），返回新生成的 title；调用方负责把 title 通过 `PATCH /api/sessions/{id}` 写回
- `Session` 模型新增 `title_auto_generated: bool` 标记字段，标识该 title 是否已经过 AI 自动生成
- Hermes 服务层新增 `_generate_session_title(user_msg, assistant_msg)` 私有方法，复用现有 `CLIExecutor` 调用 `hermes chat -q "..." -Q`
- 前端 `App.tsx` 在 `chatWithHermesStreaming.onDone` 之后触发自动命名（**仅当 Session.title 仍为默认占位"新会话"**），调后端 `POST /api/sessions/{id}/auto-title` 拿新 title，再调 `PATCH /api/sessions/{id}` 写回；同时更新本地 `sessions` 列表
- 侧边栏（`Sidebar.tsx`）订阅 sessions 列表变化，自动反映新的 title
- 失败兜底：AI 总结调用失败时静默忽略（不打断对话，保留原 title 占位"新会话"），下次首条消息时再重试
- 与现有 `conversation-history-sidebar` spec 兼容：不影响 `title` 字段的数据类型、API 契约、`title` 的可手动编辑能力

## Impact
- Affected specs: `conversation-history-sidebar`（依赖 Session.title 字段、依赖 PATCH 端点）
- Affected code:
  - `backend/app/models.py` — `Session` 新增 `title_auto_generated: bool` 字段（默认 False）
  - `backend/app/database.py` — `_run_legacy_migration` 给 sessions 表加 `title_auto_generated` 列（`ALTER TABLE ADD COLUMN`，默认 0）
  - `backend/app/api/sessions.py` — 新增 `POST /api/sessions/{id}/auto-title` 端点（请求体 `{"user_message": str, "assistant_message": str}`，返回 `{"title": str}`）
  - `backend/app/services/hermes_service.py` — 新增 `_generate_session_title(user_msg, assistant_msg) -> str` 私有方法，调用 `hermes chat -q "<短 prompt>" -Q` 并解析输出截取标题
  - `backend/app/api/hermes.py` — 在 `chat_with_hermes` / `chat_with_hermes_streaming` 响应体新增 `session_title: str`（AI 生成的标题），前端用此字段直接更新 title 而不需要额外调用
  - `frontend/src/hooks/useApi.ts` — `chatWithHermes` / `chatWithHermesStreaming` 回调 `onDone` 接受 `title?: string` 字段
  - `frontend/src/App.tsx` — `onDone` 中若返回 `title` 且 `sessions[currentSessionId].title === '新会话'`，调 `updateSession()` 写回并更新本地 sessions 列表
  - `frontend/src/components/Sidebar.tsx` — 接收 `sessions` prop 并使用最新 title

---

## ADDED Requirements

### Requirement: 自动对话名称生成
系统 SHALL 在用户首次完成一次完整对话（用户消息 + Hermes 回复）后，自动调用 Hermes 对该对话进行语义总结，生成一个简洁的中文对话名称（6-16 字），并更新到 Session.title。

#### Scenario: 首次对话触发自动命名
- **WHEN** 用户在新 Session 中首次发送消息（Session.title 仍为默认占位"新会话"）
- **AND** Hermes 流式回复完成（onDone）
- **THEN** 后端在 chat_with_hermes_streaming 完成时调用 Hermes 总结接口生成 6-16 字中文标题
- **AND** 把该标题写回 Session.title 并设置 `title_auto_generated=true`
- **AND** 在响应体 SSE 最后一条 `done` 事件中包含 `title` 字段（前端无需再调额外接口）

#### Scenario: 后续对话不重复生成
- **WHEN** 用户在同一 Session 中发送第二条 / 第三条消息
- **THEN** 后端**不**再调用自动命名接口（避免重复消耗 LLM token）
- **AND** 原有 title 保持不变

#### Scenario: 用户手动重命名后不再覆盖
- **WHEN** 用户已通过 `PATCH /api/sessions/{id}` 手动修改过 title（title_auto_generated=False 但 title 不是占位）
- **THEN** 自动命名接口**不**触发（避免覆盖用户意图）
- **AND** 后续每次新消息都不会自动改名

#### Scenario: 手动重命名后的再次自动命名
- **WHEN** 用户想"重置"为 AI 自动命名
- **THEN** 提供"自动命名"按钮（可选，放在侧边栏会话项右键菜单或编辑标题旁的图标），调 `POST /api/sessions/{id}/auto-title` 强制重新生成
- **AND** 设置 `title_auto_generated=true`

---

### Requirement: 总结 prompt 与生成策略
Hermes 总结接口 SHALL 使用一个简短 prompt，要求 LLM 输出**纯文本标题**（6-16 中文字符），不输出 markdown / 引号 / 解释。

#### Scenario: Prompt 内容
- **WHEN** 调用自动命名接口
- **THEN** 后端组装 prompt：`"请用 6-16 个中文字符总结以下对话的主题，作为侧边栏对话标题。要求：纯文本、不要引号、不要 markdown、不要解释。\n用户：{user_msg[:200]}\n助手：{assistant_msg[:300]}"` 后调用 `hermes chat -q <prompt> -Q`
- **AND** 解析输出：取第一非空行，去除前后空白与成对引号

#### Scenario: 长度校验
- **WHEN** 生成的标题超过 16 字
- **THEN** 截断到 16 字（中文按字符计算，英文按词计算）
- **AND** 若生成结果 < 4 字或为空，抛错并 fallback 到"截取首条用户消息前 30 字"（保留旧行为）

#### Scenario: 失败兜底
- **WHEN** Hermes 调用失败（超时 / 退出码非 0 / 输出为空）
- **THEN** 自动命名接口返回原 title（保持不变），不修改 Session
- **AND** 错误日志记录，但不向用户暴露

---

### Requirement: 总结端点
系统 SHALL 提供 `POST /api/sessions/{id}/auto-title` REST 端点，供前端在新消息触发时同步调用。

#### Scenario: 请求
- **WHEN** 前端调用 `POST /api/sessions/{id}/auto-title` body `{"user_message": str, "assistant_message": str}`
- **THEN** 后端：
  1. 校验 Session 存在（不存在 404）
  2. 校验两个 message 字段非空（任一为空 400）
  3. 调用 `_generate_session_title(user_msg, assistant_msg)` 拿到新 title
  4. `PATCH` Session.title = 新 title + title_auto_generated = True
  5. 返回 `{"title": "新标题", "session_id": "..."}`

#### Scenario: SSE 端点同源触发
- **WHEN** 后端在 `chat_with_hermes_streaming` 流式完成（done 事件）时
- **THEN** 自动同步生成 title 并把 `title` 字段塞到 done 事件的 data 中
- **AND** 前端在 `onDone` 回调读取 `event.title` 并调 `updateSession()` 写回（虽然后端已写回，前端再次写回幂等）

---

### Requirement: 首次对话自动判断
系统 SHALL 仅在 Session 为"新创建且 title 未被自动生成过"的场景下触发自动命名。

#### Scenario: Session 状态判断
- **WHEN** 后端处理新对话完成
- **THEN** 读取 `Session.title_auto_generated` 字段
- **AND** 若为 `False` 且 `title` 等于占位"新会话" → 触发自动命名
- **AND** 若为 `True` 或 title 已被用户修改过 → 跳过

#### Scenario: 旧数据迁移
- **WHEN** 启动时加载已有 Session（无 `title_auto_generated` 字段）
- **THEN** 数据库迁移：`ALTER TABLE sessions ADD COLUMN title_auto_generated BOOLEAN DEFAULT 0`
- **AND** 对所有非占位 title（不是"新会话"）的记录回填 `title_auto_generated=1`（视为已被用户/AI 命名过）

---

### Requirement: 侧边栏实时反映新标题
前端 SHALL 在 Session.title 更新后，**立即**在侧边栏显示新标题，无需用户手动刷新。

#### Scenario: SSE done 事件携带 title
- **WHEN** 前端 `onDone` 回调收到 `event.title` 字段
- **THEN** 前端调 `updateSession(id, { title })` 写回（后端幂等处理）
- **AND** 同步更新本地 `sessions` state 中该 session 的 title
- **AND** Sidebar 重新渲染展示新 title

#### Scenario: 失败静默
- **WHEN** 自动命名接口失败（前端 `updateSession` 抛错）
- **THEN** 前端 console.warn 记录但**不**向用户展示 toast
- **AND** 不影响对话流程

---

## MODIFIED Requirements

### Requirement: Session 字段定义（来自 conversation-history-sidebar）
Session 模型 SHALL 在原有字段基础上新增 `title_auto_generated: bool`（默认 False，标识 title 是否已经过 AI 自动生成）。

#### Scenario: Session 字段扩展
- **WHEN** 创建或读取 Session
- **THEN** 字段集：`id` / `title` / `title_auto_generated` / `created_at` / `last_active_at` / `user_first_message` / `message_count` / `status`

#### Scenario: PATCH 响应包含新字段
- **WHEN** `GET /api/sessions/{id}` / `GET /api/sessions/{id}/detail` 返回 Session
- **THEN** 响应 JSON 包含 `title_auto_generated: bool`

---

## REMOVED Requirements
无
