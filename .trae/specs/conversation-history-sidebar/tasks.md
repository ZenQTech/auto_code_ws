# Tasks

- [x] Task 1: 后端数据模型 — 新增 Session 表 + 关联外键
  - 1.1 在 `backend/app/models.py` 新增 `Session` ORM 模型（id / title / created_at / last_active_at / user_first_message / message_count / status）
  - 1.2 为 `Agent` 模型新增 `session_id` 外键列（String(36)，nullable）
  - 1.3 为 `Task` 模型新增 `session_id` 外键列（nullable）
  - 1.4 为 `Conversation` 模型新增 `session_id` 外键列（nullable）
  - 1.5 在 `Session` 模型上定义 `agents` / `tasks` / `conversations` 关系
  - 1.6 数据迁移：启动时将所有 `session_id IS NULL` 的记录归入 `legacy-default` Session
  - 1.7 数据库初始化函数 `init_db` 在检测到新字段时执行 `ALTER TABLE ... ADD COLUMN`（SQLite 兼容）

- [x] Task 2: 后端 Sessions API
  - 2.1 创建 `backend/app/api/sessions.py` 新模块
  - 2.2 `POST /api/sessions` — 创建新 Session（自动生成 title 截取规则）
  - 2.3 `GET /api/sessions` — 列出所有 Session（按 last_active_at 倒序），支持 `?status=active|archived` 过滤
  - 2.4 `GET /api/sessions/{id}` — 单个 Session 元数据
  - 2.5 `GET /api/sessions/{id}/detail` — 聚合详情（session + messages + agents + tasks + conversations）
  - 2.6 `PATCH /api/sessions/{id}` — 更新 title / status / last_active_at
  - 2.7 `DELETE /api/sessions/{id}` — 删除（级联 agents / tasks / conversations，Session 本身硬删除）
  - 2.8 在 `backend/app/api/__init__.py` 注册 `sessions` 路由

- [x] Task 3: Hermes 服务层改造 — 持久化主对话
  - 3.1 `HermesService.chat_with_hermes_streaming` 接受可选 `session_id` 参数
  - 3.2 用户消息发送时调用 `POST /api/conversations` 持久化（role='user', session_id=xxx）
  - 3.3 首次 Hermes 回复时创建 `conversations` 记录（role='assistant', session_id=xxx, content=''）
  - 3.4 流式 text 片段持续追加到该 assistant 记录的 content
  - 3.5 流式结束（onDone）时把 thinking 内容写入 metadata.thinking
  - 3.6 每次对话完成后更新 Session 的 `last_active_at` 与 `message_count`（`PATCH /api/sessions/{id}`）
  - 3.7 `HermesService.optimize_and_plan` 创建的 Agent / Task 时传递 `session_id`（持久化到 agents.session_id / tasks.session_id）
  - 3.8 `HermesService.confirm_and_execute` 创建的子任务也带 `session_id`

- [x] Task 4: 前端类型与 API hooks
  - 4.1 在 `frontend/src/types/index.ts` 新增 `Session` 类型
  - 4.2 新增 `SessionDetail` 类型（含 messages / agents / tasks / conversations 聚合）
  - 4.3 在 `frontend/src/hooks/useApi.ts` 新增 `useSessions()` 钩子
  - 4.4 新增 `useSessionDetail(sessionId)` 钩子
  - 4.5 新增 `createSession()` / `switchSession()` / `deleteSession()` / `renameSession()` 异步函数
  - 4.6 扩展 `Conversation` 类型新增 `session_id` 字段

- [x] Task 5: 前端 Sidebar 组件
  - 5.1 新增 `frontend/src/components/Sidebar.tsx`，包含折叠态（64px）与展开态（320px）两种形态
  - 5.2 新增 `frontend/src/components/SessionListItem.tsx`，展示 title / 时间副标题 / 消息数徽章 / hover 删除按钮
  - 5.3 Sidebar 顶部 Logo 按钮：点击展开/收起
  - 5.4 Sidebar 顶部搜索框：实时过滤会话列表
  - 5.5 边栏底部固定区：用户信息 / 设置 / 帮助（占位）
  - 5.6 Sidebar 应用已有的 `glass` / `glow-hermes` / `icon-btn` / `btn-ghost` 工具类与 v2.3.0 设计语言
  - 5.7 展开/收起过渡：280ms `cubic-bezier(0.16, 1, 0.3, 1)`，主区域 `flex-1` 自适应

- [x] Task 6: App.tsx 主结构改造
  - 6.1 App 组件根 `<div className="min-h-screen bg-surface-50 flex">` 内新增 Sidebar
  - 6.2 顶部 header 区域在 Logo 之后新增"新建任务"按钮（icon-btn 风格，+ 图标）
  - 6.3 新增状态 `currentSessionId: string | null` + `sidebarExpanded: boolean` + `sessions: Session[]`
  - 6.4 `useEffect` 初始化：检查 localStorage `current_session_id`；有则加载详情，无则 `createSession()` 并写入 localStorage
  - 6.5 切换会话时调用 `loadSessionDetail(id)`，替换 messages / agents / tasks 状态
  - 6.6 新建任务按钮 `handleNewTask`：调 `createSession()`，写入 localStorage，重置 messages
  - 6.7 `handleSendMessage` 改为先把用户消息持久化（POST /api/conversations），再触发流式 Hermes 对话

- [x] Task 7: 历史会话渲染
  - 7.1 切换到历史 Session 时，messages 状态从 sessionDetail.messages 加载
  - 7.2 思考内容从 metadata.thinking 渲染到 ThinkingBlock（默认折叠）
  - 7.3 Agent 列表从 sessionDetail.agents 渲染
  - 7.4 Agent 展开时调用 `useConversations(agentId)` 获取该 Agent 历史对话
  - 7.5 Task 列表从 sessionDetail.tasks 渲染（折叠态可显示摘要）

- [x] Task 8: localStorage 持久化与恢复
  - 8.1 App 启动时读取 `localStorage.getItem('current_session_id')`
  - 8.2 有效 session_id 存在时调用 `useSessionDetail(id)` 加载
  - 8.3 切换会话时同步更新 localStorage
  - 8.4 若 localStorage 中 session_id 对应的 Session 已被删除（API 返回 404），自动回退创建新 Session

- [x] Task 9: 构建与回归验证
  - 9.1 后端 `python -c "import backend.app.main"` 启动无报错
  - 9.2 前端 `npm run build` 无编译错误
  - 9.3 端到端：访问网页 → 自动创建 Session → 发送消息 → 切换到历史 Session → 看到完整历史 → 新建任务 → 列表更新
  - 9.4 视觉验证：边栏展开/收起过渡平滑，会话列表渲染正确，激活态高亮，删除二次确认生效
  - 9.5 性能验证：切换会话单次请求 `GET /api/sessions/{id}/detail` < 500ms（10 条 conversations + 3 个 agents）

# Task Dependencies
- Task 1（数据模型）是所有后端任务的前置
- Task 2（API）依赖 Task 1
- Task 3（Hermes 持久化）依赖 Task 2
- Task 4（前端 hooks）依赖 Task 2 完成（API 契约确定）
- Task 5（Sidebar）独立，可在 Task 4 后并行
- Task 6（App.tsx）依赖 Task 4 + Task 5
- Task 7（历史渲染）依赖 Task 6
- Task 8（localStorage）依赖 Task 6
- Task 9（验证）依赖 Task 1-8 全部完成
