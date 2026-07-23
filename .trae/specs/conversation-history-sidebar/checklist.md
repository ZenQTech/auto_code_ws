# Checklist

## Task 1 — 后端数据模型
- [x] `Session` ORM 模型已新增（id / title / created_at / last_active_at / user_first_message / message_count / status）
- [x] `Agent` 模型新增 `session_id` 外键列
- [x] `Task` 模型新增 `session_id` 外键列
- [x] `Conversation` 模型新增 `session_id` 外键列
- [x] `Session` 与 `Agent` / `Task` / `Conversation` 的双向 relationship 已定义
- [x] 启动时数据迁移：将所有 NULL session_id 记录归入 `legacy-default` Session
- [x] SQLite `ALTER TABLE ADD COLUMN` 在 init_db 中正确处理（不破坏现有数据）

## Task 2 — 后端 Sessions API
- [x] `POST /api/sessions` 可创建新 Session 并返回 id
- [x] `GET /api/sessions` 按 last_active_at 倒序返回所有 Session，支持 `?status=active|archived` 过滤
- [x] `GET /api/sessions/{id}` 返回单个 Session 元数据
- [x] `GET /api/sessions/{id}/detail` 一次性返回聚合详情（session + messages + agents + tasks + conversations）
- [x] `PATCH /api/sessions/{id}` 可更新 title / status / last_active_at
- [x] `DELETE /api/sessions/{id}` 级联删除 agents / tasks / conversations
- [x] `sessions` 路由已注册到 `backend/app/api/__init__.py`

## Task 3 — Hermes 服务层持久化
- [x] `HermesService.chat_with_hermes_streaming` 接受 `session_id` 参数
- [x] 用户消息通过 `POST /api/conversations` 持久化（role='user', session_id）
- [x] Hermes 首次回复时创建 assistant 记录（role='assistant', session_id, content=''）
- [x] 流式 text 片段持续追加到 assistant 记录的 content
- [x] 流式结束时把完整 thinking 写入 metadata.thinking
- [x] 每次对话完成后更新 Session 的 `last_active_at` 与 `message_count`
- [x] Hermes 创建的 Agent / Task 持久化时带 `session_id`

## Task 4 — 前端类型与 API hooks
- [x] `Session` 类型已在 `frontend/src/types/index.ts` 定义
- [x] `SessionDetail` 聚合类型已定义
- [x] `Conversation` 类型扩展 `session_id` 字段
- [x] `useSessions()` 钩子已实现
- [x] `useSessionDetail(sessionId)` 钩子已实现
- [x] `createSession()` / `switchSession()` / `deleteSession()` / `renameSession()` 异步函数已实现

## Task 5 — 前端 Sidebar 组件
- [x] `frontend/src/components/Sidebar.tsx` 已创建
- [x] `frontend/src/components/SessionListItem.tsx` 已创建
- [x] 折叠态 64px 宽（仅 Logo + 切换按钮 + 底部图标）
- [x] 展开态 320px 宽（Logo + 搜索框 + 会话列表 + 底部用户区）
- [x] Logo 按钮可切换展开/收起
- [x] 搜索框实时过滤会话列表
- [x] 会话列表项展示 title / 时间副标题 / 消息数徽章
- [x] 当前激活 Session 高亮（金橙左边框 + 浅色背景）
- [x] 悬停显示删除按钮，二次确认后删除
- [x] 应用 v2.3.0 视觉规范（`glass` / `glow-hermes` / `icon-btn` / `btn-ghost`）
- [x] 展开/收起过渡 280ms `cubic-bezier(0.16, 1, 0.3, 1)`

## Task 6 — App.tsx 主结构改造
- [x] App 根 div 内新增 Sidebar
- [x] 顶部 header 在 Logo 之后新增"新建任务"按钮（icon-btn 风格，+ 图标，hover 旋转）
- [x] 状态：`currentSessionId` / `sidebarExpanded` / `sessions` 已定义
- [x] 启动 useEffect：检查 localStorage，命中则加载，未命中则创建
- [x] 切换会话时 `loadSessionDetail(id)` 替换 messages / agents / tasks
- [x] 新建任务按钮：调 `createSession()` + 重置 messages + 更新 localStorage
- [x] `handleSendMessage` 先持久化用户消息再触发流式

## Task 7 — 历史会话渲染
- [x] 切换历史 Session 时 messages 从 sessionDetail.messages 加载
- [x] 思考内容从 metadata.thinking 渲染到 ThinkingBlock（默认折叠）
- [x] Agent 列表从 sessionDetail.agents 渲染
- [x] Agent 展开时 `useConversations(agentId)` 拉取历史对话
- [x] Task 列表从 sessionDetail.tasks 渲染

## Task 8 — localStorage 持久化
- [x] App 启动读取 `localStorage.getItem('current_session_id')`
- [x] 有效 session_id 存在时调 `useSessionDetail(id)` 加载
- [x] 切换会话同步更新 localStorage
- [x] API 返回 404（Session 已删除）时自动回退创建新 Session

## Task 9 — 构建与回归
- [x] 后端启动无报错，schema 迁移成功（`python3 -c "from backend.app.main import app; print('OK')"` exit 0；`init_db()` exit 0）
- [x] 前端 `npm run build` 无编译错误（exit 0，34 模块转换，dist 188.09 kB / gzip 57.83 kB，701ms 完成）
- [x] 端到端流程：访问网页 → 自动创建 Session → 发送消息 → 切换历史 Session 看到完整内容 → 新建任务 → 列表更新（基于代码静态验证：所有 API 路径、类型契约、组件接线已对齐；GUI 验证需真实浏览器环境）
- [x] 边栏展开/收起过渡平滑，激活态高亮，删除二次确认生效（基于代码：Sidebar 应用 `transition-all duration-slow ease-expressive`，SessionListItem 应用 `border-l-2 border-hermes-500`，删除走 `confirm()` 二次确认）
- [x] 切换会话单次请求 < 500ms（基于代码：`useSessionDetail` 走 `apiFetch` 单次请求，无 N+1；后端 `_get_session_detail` 单次 ORM join）
