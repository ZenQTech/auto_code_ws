# 对话历史与左侧边栏 Spec

## Why
当前平台所有 Hermes 对话、Claude Code CLI 实例对话均未持久化为"会话"概念：用户每次打开网页都从空白开始（App.tsx 内存中的 `messages` 状态在页面刷新后丢失），无法回溯历史任务，也无法在多个历史任务间快速切换。需要引入"会话（Session）"作为顶层组织单元，会话是用户一次完整任务的容器，下辖 Hermes 主对话、Claude Code CLI 实例、子任务、历史消息；左侧边栏提供历史会话的列表与切换入口。

## What Changes
- 引入"会话（Session）"顶层数据模型：每次打开网页自动创建新会话，单击历史会话可恢复完整上下文
- 后端新增 `sessions` 表 + `Session` ORM 模型 + `/api/sessions` REST API
- `agents` / `tasks` / `conversations` 表新增 `session_id` 外键，建立完整归属关系
- Hermes 主对话持久化：用户消息和 Hermes 回复（含 thinking + text）写入 `conversations` 表
- 左侧边栏：默认折叠为 64px 宽图标条（仅 Logo + 切换按钮），展开为 320px 宽（含搜索框 + 会话列表 + 新建按钮）
- 顶部新增"新建会话"按钮，单击后立即创建新会话并切换到该会话
- 历史会话打开后：Hermes 主对话历史 + 该会话下所有 Claude Code CLI 实例及其历史对话 + 任务列表 + 智能体卡片，全部自动恢复
- **BREAKING**：原 `ChatMessage` 仅存在内存，需迁移到 `conversations` 表 + session 关联

## Impact
- Affected specs: streaming-thinking（SSE 流式需按 session 分组）、hermes-scheduling-upgrade（Hermes 流程需关联 session）、visual-polish-and-motion（顶部 / 边栏新增 UI 元素）
- Affected code:
  - `backend/app/models.py` — 新增 `Session` 模型；`Agent` / `Task` / `Conversation` 新增 `session_id` 外键
  - `backend/app/api/sessions.py` — 新增 `/api/sessions` 路由（CRUD + 详情聚合）
  - `backend/app/services/hermes_service.py` — `chat_with_hermes` / `chat_with_hermes_streaming` / `optimize_and_plan` / `confirm_and_execute` 全部接受 `session_id` 并持久化对话
  - `backend/app/main.py` — 启动时确保 schema 迁移（新增字段非破坏性）
  - `frontend/src/components/Sidebar.tsx` — 新增左侧边栏组件
  - `frontend/src/components/SessionListItem.tsx` — 新增会话列表项
  - `frontend/src/hooks/useApi.ts` — 新增 `useSessions` / `createSession` / `switchSession` / `deleteSession` / `useSessionDetail`
  - `frontend/src/types/index.ts` — 新增 `Session` / `SessionDetail` 类型
  - `frontend/src/App.tsx` — 渲染 Sidebar、自动创建会话、加载历史会话的完整上下文

---

## ADDED Requirements

### Requirement: Session 数据模型
系统 SHALL 提供"会话（Session）"作为顶层数据组织单元，每个 Session 聚合以下数据：
- Hermes 主对话历史（user + assistant，含 thinking / text 区分）
- 该会话下创建的所有 Claude Code CLI 子实例（Agent）
- 该会话下创建的所有子任务（Task）
- 任务执行产生的所有对话记录（Conversation）

#### Scenario: Session 字段
- **WHEN** 创建 Session
- **THEN** Session 必须包含字段：`id`（UUID）、`title`（默认截取首条用户消息前 30 字）、`created_at`、`last_active_at`、`user_first_message`（首条用户消息全文，用于侧边栏副标题）、`message_count`（对话条数缓存）、`status`（active / archived）

#### Scenario: Session 关联完整性
- **WHEN** 创建 Agent / Task / Conversation
- **THEN** 必须关联到指定 `session_id`（外键，非空）
- **AND** 关联对象在删除 Session 时级联删除（或软删除）

---

### Requirement: 自动创建新会话
系统 SHALL 在用户首次访问 / 刷新网页时自动创建一个新的 Session，确保用户永远从一个干净的画布开始。

#### Scenario: 首次访问
- **WHEN** 用户打开网页（localStorage 中无 `current_session_id`）
- **THEN** 自动调用 `POST /api/sessions` 创建一个空 Session
- **AND** 将 `session_id` 写入 localStorage
- **AND** 跳转到该新会话（空状态 + 欢迎语）

#### Scenario: 已有会话继续访问
- **WHEN** 用户再次打开网页（localStorage 中有 `current_session_id`）
- **THEN** 加载该历史会话的完整上下文（Hermes 主对话、Agents、Tasks、Conversations）
- **AND** 用户可继续在该会话中发送消息
- **AND** "自动开启新任务对话" 的语义：若用户在"已有会话"中发首条消息，则更新该会话的 `last_active_at`；若用户单击"新建任务"按钮，则**强制创建新 Session**

#### Scenario: 新建任务按钮
- **WHEN** 用户单击顶部"新建任务"按钮（图标 + tooltip "新建对话"）
- **THEN** 立即创建新 Session，切换到该新会话，旧会话保留在侧边栏历史列表中
- **AND** 新会话默认展开空对话界面，焦点自动定位到输入框

---

### Requirement: 左侧边栏（Sidebar）
系统 SHALL 在主界面左侧提供可折叠的侧边栏，用于浏览历史会话。

#### Scenario: 边栏默认折叠
- **WHEN** 用户首次进入页面
- **THEN** 边栏以 64px 宽的图标条形态显示：顶部 Logo（点击收起/展开切换按钮）、底部设置 / 帮助图标
- **AND** 主内容区域占满剩余宽度

#### Scenario: 边栏展开
- **WHEN** 用户点击 Logo 或展开按钮
- **THEN** 边栏以 320px 宽形态展开：包含搜索框 + 会话列表 + 底部用户信息
- **AND** 主内容区域压缩到剩余宽度
- **AND** 展开/收起使用 `cubic-bezier(0.16, 1, 0.3, 1)` 280ms 缓出曲线，宽度变化平滑过渡

#### Scenario: 会话列表渲染
- **WHEN** 边栏展开
- **THEN** 显示所有历史 Session 列表（按 `last_active_at` 倒序）
- **AND** 每项展示：标题（首条用户消息前 30 字）、副标题（时间，如"刚刚 / 5 分钟前 / 昨天 14:30"）、消息数徽章
- **AND** 当前激活的 Session 高亮显示（金橙左边框 + 浅色背景）
- **AND** 悬停时显示删除按钮（垃圾桶图标，点击二次确认后删除）

#### Scenario: 搜索过滤
- **WHEN** 用户在边栏搜索框输入关键词
- **THEN** 会话列表实时过滤（按 title / user_first_message 模糊匹配），仅显示匹配的 Session
- **AND** 空结果时显示"无匹配会话"空状态

#### Scenario: 切换会话
- **WHEN** 用户单击某个历史 Session
- **THEN** 立即切换当前激活的 session
- **AND** 主区域加载该 Session 的完整上下文（Hermes 主对话、Agents、Tasks、Conversations）
- **AND** 输入框焦点定位，便于继续对话

---

### Requirement: Hermes 主对话持久化
系统 SHALL 将用户与 Hermes 的所有对话（含流式 thinking / text）持久化到 `conversations` 表，按 session_id 归属。

#### Scenario: 用户消息发送
- **WHEN** 用户在 App.tsx 输入框发送消息
- **THEN** 立即创建一条 `conversations` 记录（role='user'，session_id=当前，content=消息全文）
- **AND** 同时更新 Session 的 `last_active_at` 与 `message_count`

#### Scenario: Hermes 流式回复
- **WHEN** Hermes 流式返回 thinking 和 text 片段
- **THEN** 按以下策略持久化：
  - 首次收到 Hermes 回复时创建 `conversations` 记录（role='assistant'，content='', session_id=当前）
  - 每个 text 片段实时追加到该记录的 content（按 `,` 分隔在 metadata 中标识"stream"）
  - 完整的 thinking 内容存到 metadata.thinking（不混入 content）
  - 流式结束（onDone）时该记录为最终态

#### Scenario: 历史会话打开恢复 Hermes 主对话
- **WHEN** 用户切换到历史 Session
- **THEN** 调用 `GET /api/conversations?session_id=xxx` 获取该 Session 下所有 role='user' / 'assistant' 的对话
- **AND** 渲染为 App.tsx 消息列表（按 created_at 升序）
- **AND** 思考内容从 metadata.thinking 读取并显示在 ThinkingBlock 中（默认折叠）

---

### Requirement: Claude Code CLI 实例归属
系统 SHALL 将每个 Claude Code CLI 实例（Agent）关联到创建它的 Session，历史会话打开时这些实例的历史对话可恢复。

#### Scenario: Agent 创建时归属 Session
- **WHEN** Hermes 创建 Claude Code CLI 子实例
- **THEN** `agents` 表新增 `session_id` 字段，存值=当前 Session
- **AND** 同时在 `AgentChatCard` 中显示"所属会话：{session_title}"

#### Scenario: Agent 历史对话
- **WHEN** 用户打开历史 Session
- **THEN** 该 Session 下所有 Agent 卡片正常渲染
- **AND** 每个 Agent 展开时显示其历史对话（`conversations` 表中 agent_id 关联的记录，按 created_at 升序）
- **AND** 显示 Token / API 调用累计统计

#### Scenario: Agent 跨会话隔离
- **WHEN** 用户切换到新 Session
- **THEN** 新 Session 看不到旧 Session 的 Agent（除非通过 `GET /api/agents?session_id=xxx` 显式查询）
- **AND** 新 Session 默认 agent 列表为空，需通过对话触发创建

---

### Requirement: Session 详情聚合 API
系统 SHALL 提供 `GET /api/sessions/{id}/detail` 一次性返回完整上下文，避免前端 N+1 请求。

#### Scenario: 会话详情响应
- **WHEN** 调用 `GET /api/sessions/{id}/detail`
- **THEN** 返回 JSON 包含：
  - `session` 元数据
  - `messages`: 该 Session 的 Hermes 主对话列表（每条含 thinking / text）
  - `agents`: 该 Session 下所有 Agent
  - `tasks`: 该 Session 下所有 Task
  - `conversations`: 完整对话记录（含 user / assistant / system，按 created_at 升序）
- **AND** 单次响应，前端切换会话时一次请求即可恢复全部上下文

#### Scenario: 列表与详情分离
- **WHEN** 边栏渲染会话列表
- **THEN** 调用 `GET /api/sessions` 获取精简列表（id / title / last_active_at / message_count）
- **AND** 单击切换时才调用 `GET /api/sessions/{id}/detail` 加载详情

---

### Requirement: Session 管理操作
系统 SHALL 提供会话的重命名、删除、归档操作。

#### Scenario: 重命名会话
- **WHEN** 用户在边栏会话项上点击"编辑"图标
- **THEN** 标题变为可编辑输入框，回车保存
- **AND** 调用 `PATCH /api/sessions/{id}` 更新 title

#### Scenario: 删除会话
- **WHEN** 用户在边栏会话项悬停时点击垃圾桶图标
- **THEN** 弹出二次确认（"确定删除此会话？所有对话记录将被清除"）
- **AND** 确认后调用 `DELETE /api/sessions/{id}`，级联删除该 Session 下的 agents / tasks / conversations
- **AND** 若删除的是当前激活 Session，自动切换到列表中下一个 Session（或创建新 Session）

#### Scenario: 归档会话
- **WHEN** 用户长按 / 右键会话项
- **THEN** 弹出菜单包含"归档"选项
- **AND** 调用 `PATCH /api/sessions/{id}` 更新 status='archived'
- **AND** 归档会话默认不显示在主列表，需在搜索框输入或在"归档"标签页查看

---

### Requirement: 数据迁移与向后兼容
新增 Session 模型与外键关联 SHALL 不破坏现有数据（不删除旧 conversations / tasks / agents）。

#### Scenario: 旧数据归属
- **WHEN** 数据库中已有 conversations / tasks / agents 记录但 session_id 为 NULL
- **THEN** 启动时执行数据迁移：将所有 NULL session_id 记录归属到名为"历史会话（自动迁移）"的特殊 Session（id 固定为 `legacy-default`）
- **AND** 迁移后所有记录都有非空 session_id

#### Scenario: 向后兼容 API
- **WHEN** 前端调用旧 API（不带 session_id）
- **THEN** 后端若未传 session_id，自动使用 `legacy-default` 兜底
- **AND** 旧数据正常展示

---

## MODIFIED Requirements

### Requirement: 顶部标题栏（来自 visual-polish-and-motion）
顶部标题栏 SHALL 在 Logo 之后新增"新建任务"按钮（icon-btn 风格，旋转 + 加号图标，hover 时 +45° 旋转动效），并支持边栏展开时主区域宽度自适应压缩。

#### Scenario: 新建任务按钮
- **WHEN** 任意状态下用户点击"新建任务"按钮
- **THEN** 立即创建新 Session 并切换过去

#### Scenario: 主区域宽度自适应
- **WHEN** 边栏展开 / 收起
- **THEN** 主区域 `flex-1` 自动适配剩余宽度，无横向滚动条

---

## REMOVED Requirements
无
