# 简化会话标题显示 Spec

## Why
刚完成的 `auto-session-title-generation` spec 引入 Hermes AI 自动总结生成 6-16 字中文对话标题的方案，但实测存在两个问题：① 每次首次对话消耗 LLM token（10-30 秒延迟 + 额外 API 配额消耗），加重火山引擎 Coding Plan 429 限流；② 用户实际更倾向于"原始消息开头"作为辨识依据（搜索/回忆原始需求），AI 总结反而增加认知负担。**回退该方案**，改为**纯前端策略**：用户未发送消息时显示"新对话"，发送首条消息后标题直接显示为"用户首条消息的前 N 个字 + 省略号"（仅一行截断），与 `conversation-history-sidebar` spec 的"截取首条用户消息前 30 字"策略对齐但**完全前端实现**（不依赖后端 PATCH）。该方案零 token 消耗、零延迟、零后端依赖。

## What Changes
- **完全撤销** `auto-session-title-generation` spec 的所有后端 AI 总结逻辑：移除 `_generate_session_title` 私有方法、`POST /api/sessions/{id}/auto-title` 端点、SSE done 事件携带 title 字段、Session.title_auto_generated 字段与数据库迁移回填
- 前端 `SessionListItem.tsx` 的 title 渲染逻辑改为**派生计算**：不再依赖 `Session.title` 字段的写回值，而是按以下规则**实时计算展示**：
  1. 若 `session.message_count === 0`（无消息）→ 显示"新对话"
  2. 否则（已有消息）→ 取 `session.user_first_message`（后端已有的"首条用户消息全文"字段），**单行省略号**截断（CSS `truncate` 类 + `max-w` 控制宽度），保留开头部分
- 保留 Session.title 字段的**手动重命名**能力：用户仍可编辑 title（通过侧边栏右键 / hover 编辑），手动 title 优先级高于"自动截取"
- **不再**修改 Session.title 字段（前端只读展示，不写回）
- **不再**调 `updateSession` 写回 title（节省 API 调用）

## Impact
- Affected specs: `auto-session-title-generation`（**REMOVED**）、`conversation-history-sidebar`（修改 SessionListItem 渲染逻辑）
- Affected code:
  - **后端（移除/回退）**：
    - `backend/app/models.py` — 移除 Session.title_auto_generated 字段（或保留字段但前端不再使用）
    - `backend/app/database.py` — 移除 sessions 表的 title_auto_generated 列迁移
    - `backend/app/api/sessions.py` — 移除 `POST /api/sessions/{id}/auto-title` 端点
    - `backend/app/services/hermes_service.py` — 移除 `_generate_session_title` 私有方法 + SSE done 事件携带 title 字段
    - `backend/app/api/hermes.py` — 移除 v1.2.1 docstring 中关于 done 事件 title 字段的说明
  - **前端（修改/回退）**：
    - `frontend/src/components/SessionListItem.tsx` — 渲染逻辑改为派生计算（`message_count` + `user_first_message`），CSS 单行省略号
    - `frontend/src/hooks/useApi.ts` — onDone 回调签名回退为 `() => void`（不再接收 title）
    - `frontend/src/App.tsx` — 移除 onDone 中 `updateSession + setSessions` 自动写回 title 的代码
- **向后兼容**：保留 Session.title 字段本身（用户可手动重命名时仍可存值），只是**不再自动 PATCH**

---

## ADDED Requirements

### Requirement: 前端纯截取显示策略
前端 SessionListItem SHALL 按以下规则**实时计算**侧边栏会话项的 title 展示，**不依赖后端 Session.title 字段的自动写回**。

#### Scenario: 新对话（无消息）
- **WHEN** `session.message_count === 0`（或 `session.user_first_message` 为空字符串）
- **THEN** 侧边栏会话项显示固定文案"**新对话**"
- **AND** 该 Session 仍是新建的空白对话，没有任何对话记录

#### Scenario: 历史对话（有消息）
- **WHEN** `session.message_count > 0` 且 `session.user_first_message` 非空
- **THEN** 侧边栏会话项 title 显示为 `session.user_first_message` 的**单行省略号截断**
- **AND** 使用 Tailwind `truncate` 类（CSS `overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`）
- **AND** 容器宽度受 `max-w` 控制（边栏展开 320px - padding - 时间副标题宽度 ≈ 200px 可用宽度）
- **AND** 显示**首条用户消息的开头部分**（不是 AI 总结）

#### Scenario: 用户手动重命名优先级
- **WHEN** 用户通过侧边栏 hover 编辑 / 右键菜单手动修改过 Session.title
- **AND** title 不等于占位"新对话"
- **THEN** 侧边栏优先显示用户的**手动 title**（不被自动截取逻辑覆盖）
- **AND** 手动 title 同样应用 `truncate` 单行省略号

#### Scenario: 渲染逻辑判定顺序
- **WHEN** 渲染 SessionListItem
- **THEN** 按以下优先级计算 displayTitle：
  1. 若 `session.title` 不为空且 `!== "新会话"` → 用 `session.title`（用户手动命名优先）
  2. 否则若 `session.message_count > 0` 且 `session.user_first_message` 非空 → 用 `session.user_first_message`（首条用户消息截断）
  3. 否则 → 用固定文案"新对话"

---

### Requirement: 节省 API 调用
前端 SHALL **不再**在对话完成时调 `updateSession` 写回 title，节省 HTTP 请求。

#### Scenario: 首次对话不写回 title
- **WHEN** 用户在 Session 中首次发送消息
- **AND** Hermes 流式回复完成（onDone）
- **THEN** 前端**不**调 `updateSession` API
- **AND** 侧边栏通过 `useSessions` refetch 重新拉取列表（`session.message_count` 与 `session.user_first_message` 已由后端在流式持久化时更新，前端只读不写）
- **AND** SessionListItem 派生计算展示新 title（从"新对话"变成首条用户消息截断）

#### Scenario: onDone 回调无参数
- **WHEN** `chatWithHermesStreaming` 调用 `onDone` 回调
- **THEN** 签名回退为 `() => void`（不再传 `title?: string`）
- **AND** SSE done 事件不再携带 title 字段（后端已移除该逻辑）

---

### Requirement: 样式与展示规范
SessionListItem 的 title 展示 SHALL 保持视觉一致性与可读性。

#### Scenario: 单行省略号
- **WHEN** 渲染 title
- **THEN** 应用 Tailwind 类 `truncate`（自动处理：超出部分用 `...` 替代）
- **AND** 应用 `text-sm text-surface-700` 字号与颜色
- **AND** 副标题（时间）固定位置不变（`session.last_active_at` 相对时间显示）

#### Scenario: 视觉提示
- **WHEN** Session 处于"新对话"占位状态
- **THEN** title 文字颜色稍暗（`text-surface-700`），与有消息的 Session 视觉区分不强烈（保持侧边栏整齐）
- **AND** 消息数徽章显示"0"或隐藏（`message_count === 0` 时不显示徽章）

---

## MODIFIED Requirements

### Requirement: Session 字段定义（来自 conversation-history-sidebar）
Session 模型字段集 SHALL **不**新增 `title_auto_generated` 字段（auto-session-title-generation spec 已 REMOVED）。原有字段保持：`id` / `title`（可手动设置，默认值"新对话"）/ `created_at` / `last_active_at` / `user_first_message`（首条用户消息全文，用于前端纯截取显示）/ `message_count` / `status`。

#### Scenario: Session 字段回归
- **WHEN** 创建或读取 Session
- **THEN** 字段集不含 `title_auto_generated`
- **AND** 后端 SessionResponse 不返回该字段
- **AND** 数据库不再有该列

---

### Requirement: SessionListItem 渲染逻辑（来自 conversation-history-sidebar）
SessionListItem 组件 SHALL 改为**派生计算 displayTitle**（不依赖 Session.title 写回值），实现纯前端截取显示。

#### Scenario: 渲染函数
- **WHEN** 组件接收 `session: Session` prop
- **THEN** 内部计算 `displayTitle`：
  ```ts
  const displayTitle = (() => {
    // 1. 手动命名优先
    if (session.title && session.title !== "新对话") {
      return session.title;
    }
    // 2. 有消息时用首条用户消息
    if (session.message_count > 0 && session.user_first_message) {
      return session.user_first_message;
    }
    // 3. 占位
    return "新对话";
  })();
  ```
- **AND** 渲染 `<div className="truncate text-sm text-surface-700">{displayTitle}</div>`

---

## REMOVED Requirements

### Requirement: 自动对话名称生成（来自 auto-session-title-generation）
**Reason**：
- AI 自动总结消耗 LLM token（火山引擎 Coding Plan 5h 10000 次配额紧张，429 限流频繁）
- 总结延迟 10-30 秒影响首次对话体验
- 用户更倾向于"原始首条消息"作为辨识依据，AI 总结反而增加认知负担
- 单行省略号截断对短消息（< 16 字）已足够辨识

**Migration**：
- 后端 `_generate_session_title` 私有方法移除（不再调用 hermes 总结接口）
- 后端 `POST /api/sessions/{id}/auto-title` 端点移除（不再提供手动触发）
- 后端 SSE done 事件移除 `title` 字段（恢复为 `{"type": "done"}`）
- 后端 Session 模型移除 `title_auto_generated` 字段（数据库迁移回退）
- 前端 onDone 回调签名回退为 `() => void`（不再接收 title）
- 前端 App.tsx 移除 onDone 中的 `updateSession + setSessions` 自动写回逻辑
- **保留**：Session.title 字段（用户手动重命名时仍可存值）、SessionListItem 单行省略号截断样式（升级为派生计算策略）
