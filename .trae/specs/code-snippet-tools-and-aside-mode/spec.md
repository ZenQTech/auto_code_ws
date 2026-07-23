# 代码片段工具 + 题外话模式 Spec

## Why
用户从"用户价值 × 实现可行性"角度选择了两项互补功能：
1. **代码片段工具**（用户主选）：AI 回复中的代码块目前仅支持"复制"操作（MessageBubble 工具栏），但程序员更常用的"运行 / 格式化 / diff 对比 / 保存为片段库"操作缺失，**用户拿到 AI 写的代码后必须切换到 IDE 才能验证**——体验断点明显，浪费 30s~2min 不等。
2. **题外话模式**（用户题外话补充）：当 Hermes 主对话 / 子 Claude Code CLI 实例正在**长时间任务**（如 5min+ 规划或执行）时，用户经常遇到"等待中临时想到别的问题"的场景。当前架构下用户被迫**等待任务完成**或**中断任务**才能问新问题——前者浪费时间，后者丢失任务上下文。需要一个**不影响主任务上下文的题外话侧栏**，用户点击按钮后弹出独立问答窗口，关闭后主任务继续推进、上下文不污染。

## What Changes
- **代码片段工具（核心）**：
  - AI 消息气泡中的每个代码块右上角出现"运行 / 复制 / 保存 / diff" 4 按钮工具栏
  - **运行**：Node.js sandbox（`node -e`）实时执行，输出结果在代码块下方卡片展示（stdout / stderr / 退出码）
  - **复制**：已实现，保留
  - **保存为片段库**：弹出片段库弹窗（SnippetLibrary），用户输入片段标题 + 描述 + 标签，确认后保存到 localStorage + 后端
  - **diff 对比**：用户选中历史片段库中的某条片段，与当前代码块对比，生成 unified diff 视图（绿色 + / 红色 -）
  - 新建 `frontend/src/components/CodeBlock.tsx` 组件（替代 MessageBubble 内部的简单 `<pre>` 渲染）
- **题外话模式（补充）**：
  - 主区域右下角浮动按钮"💬 题外话"（FAB），当 `isSending` 或 `displayAgents` 中有 `status === 'running'` 时显示
  - 点击 FAB → 弹出独立右侧滑出抽屉（Drawer 280px-360px 宽），含独立输入框 + 独立消息流
  - 题外话与主对话**完全隔离**：独立的 `asideMessages` state、独立 `asideSessionId`、独立后端端点（`/api/aside/chat/stream`）
  - 题外话关闭后**不**写入主 session，不影响主 session 上下文
  - 题外话支持展开/收起（不影响主布局）
- **零后端业务变更**（除新增题外话端点）

## Impact
- Affected specs: `frontend-system-beautification-doubao`（**MODIFIED** — MessageBubble 增加代码块工具）/ `streaming-thinking`（无影响，题外话不共享流式上下文）
- Affected code:
  - **前端**：
    - `frontend/src/components/CodeBlock.tsx`（**新建**）v1.0.0：代码块组件 + 4 工具按钮
    - `frontend/src/components/SnippetLibrary.tsx`（**新建**）v1.0.0：片段库管理弹窗
    - `frontend/src/components/DiffViewer.tsx`（**新建**）v1.0.0：unified diff 视图
    - `frontend/src/components/AsideDrawer.tsx`（**新建**）v1.0.0：题外话右侧滑出抽屉
    - `frontend/src/components/MessageBubble.tsx` v1.0.0 → v1.1.0：用 CodeBlock 替换内部 `<pre>` 渲染
    - `frontend/src/App.tsx` v2.9.3 → v2.10.0：集成 CodeBlock / AsideDrawer / FAB 按钮 / asideMessages state
    - `frontend/src/hooks/useApi.ts` v1.4.0 → v1.5.0：新增 `runCode` / `asideChatStreaming` / `snippet CRUD` hooks
    - `frontend/src/types/index.ts` v1.5.0 → v1.6.0：新增 `Snippet` / `CodeExecutionResult` / `AsideMessage` / `DiffLine` 类型
  - **后端（最小新增）**：
    - `backend/app/api/aside.py`（**新建**）v1.0.0：题外话 SSE 流式端点 `POST /api/aside/chat/stream`（不写 conversations 表）
    - `backend/app/api/snippets.py`（**新建**）v1.0.0：片段库 CRUD 端点（GET / POST / DELETE `/api/snippets`）
    - `backend/app/models.py` v1.7.0 → v1.8.0：新增 `Snippet` ORM（id / title / description / language / code / tags / created_at）
    - `backend/app/database.py` v1.3.0 → v1.4.0：snippets 表迁移
    - `backend/app/api/__init__.py` v1.2.0 → v1.3.0：注册 aside_router / snippets_router

---

## ADDED Requirements

### Requirement: 代码块工具栏
系统 SHALL 在 AI 消息气泡的所有代码块右上角展示"运行 / 复制 / 保存 / diff" 4 按钮工具栏（hover 浮现），覆盖复制按钮（独立场景）。

#### Scenario: 工具栏位置与触发
- **WHEN** 鼠标 hover 代码块
- **THEN** 代码块右上角（absolute top-2 right-2）浮出 4 按钮工具栏
- **AND** 工具栏背景 `bg-white/95 backdrop-blur-sm rounded-lg shadow-level-2 border border-surface-200`
- **AND** 工具栏出现动画 `animate-fade-in`（150ms）

#### Scenario: 复制按钮
- **WHEN** 用户点击复制按钮
- **THEN** 调 `navigator.clipboard.writeText(code)` 复制代码到剪贴板
- **AND** 按钮变"已复制"状态（icon 变 Check，持续 1.5s 后恢复 Copy）
- **AND** 触发 Toast "已复制到剪贴板"

#### Scenario: 运行按钮（Node.js sandbox）
- **WHEN** 用户点击运行按钮
- **THEN** 代码块下方展开"执行结果"卡片（max-h-40 overflow-auto）
- **AND** 卡片显示"运行中..."（旋转 Spinner 图标）+ 后端调 `/api/code/run`（**新增**端点，Node.js child_process 沙箱执行）
- **AND** 完成后显示 stdout / stderr / 退出码（如 stdout=Hello\nstderr=exit code 0）
- **AND** 运行超时 5s 自动 kill
- **AND** 非 Node.js 代码（Python / Bash）显示"暂不支持该语言"提示

#### Scenario: 保存为片段
- **WHEN** 用户点击保存按钮
- **THEN** 弹出片段库保存弹窗（SnippedLibrary modal）
- **AND** 表单字段：title（必填，≤50 字）/ description（≤200 字）/ language（自动从代码块语言推断，可改）/ tags（多选标签，逗号分隔）
- **AND** 提交后调 `POST /api/snippets` 持久化
- **AND** 成功后触发 Toast "片段已保存"

#### Scenario: diff 对比
- **WHEN** 用户点击 diff 按钮
- **THEN** 弹出片段库选择弹窗（复用 SnippetLibrary）
- **AND** 用户选中某个历史片段 → 弹出 DiffViewer 对比视图
- **AND** DiffViewer 显示 unified diff（绿色 `+` / 红色 `-` / 灰色上下文）
- **AND** 关闭 DiffViewer 不影响当前对话

---

### Requirement: 片段库
系统 SHALL 提供片段库管理界面，列出所有已保存的代码片段，支持查看 / 复制 / 删除 / 用于 diff 对比。

#### Scenario: 片段库入口
- **WHEN** 用户点击顶部 BrandHeader 下拉菜单的"片段库"项
- **THEN** 弹出 SnippetLibrary modal（中央居中 + 玻璃拟态遮罩）
- **AND** 模态框内按时间倒序列出片段，每条含 title / language badge / tags / 创建时间 / 操作按钮（复制 / diff / 删除）
- **AND** 顶部搜索框（按 title / tags 关键词过滤）

#### Scenario: 片段列表
- **WHEN** 调 `GET /api/snippets` 拉取片段列表
- **THEN** 列表按 `created_at` 倒序展示（最新在前）
- **AND** 每条点击展开看完整 code（带 syntax highlight）
- **AND** 复制按钮：调 `navigator.clipboard.writeText(snippet.code)`
- **AND** diff 按钮：进入"代码块 diff 模式"（选中当前代码块后选择该片段做 diff）
- **AND** 删除按钮：调 `DELETE /api/snippets/{id}`，弹确认 dialog

#### Scenario: 片段持久化
- **WHEN** 用户保存片段或删除片段
- **THEN** 通过 `POST /api/snippets` / `DELETE /api/snippets/{id}` 持久化到后端
- **AND** 后端 ORM 存储在 `snippets` 表（id / title / description / language / code / tags / created_at）
- **AND** 创建时间由后端自动生成（`datetime.utcnow`）

---

### Requirement: 题外话模式
系统 SHALL 提供独立的题外话抽屉，与主对话**完全隔离**（不共享上下文、不影响主任务进度、不计入主 session 历史）。

#### Scenario: FAB 按钮显示
- **WHEN** 主对话正在发送（`isSending === true`）或子 CLI 实例有 `status === 'running'`
- **THEN** 主区右下角浮动按钮"💬 题外话"（FAB）出现
- **AND** FAB 位置：`fixed bottom-32 right-6 z-40`（在主对话输入区上方，**不**遮挡）
- **AND** FAB 样式：`w-14 h-14 rounded-full bg-gradient-to-br from-hermes-500 to-hermes-600 shadow-glow-hermes text-white btn-hover-lift`
- **AND** 当无任务进行时 FAB 隐藏

#### Scenario: 抽屉展开
- **WHEN** 用户点击 FAB
- **THEN** 右侧滑出抽屉（AsideDrawer），宽度 360px，高度 100vh，`fixed right-0 top-0 z-50`
- **AND** 滑出动画 `animate-slide-in-right`（300ms ease-expressive）
- **AND** 抽屉内含：顶部"题外话"标题 + 关闭按钮 + 独立消息流（asideMessages state）+ 独立输入框（区别于主输入框，独立 `asideInputValue` state）
- **AND** 抽屉背景 `bg-white/95 backdrop-blur-md` 玻璃拟态
- **AND** 抽屉内输入框回车时调 `asideChatStreaming(prompt)` → 后端 `/api/aside/chat/stream` → SSE 流式响应

#### Scenario: 题外话隔离
- **WHEN** 用户在题外话抽屉中对话
- **THEN** 题外话消息写入**独立 asideMessages state**，**不**写入主 `messages` state
- **AND** 题外话**不**调 `POST /api/sessions/{id}/detail` 持久化（**不**写入 conversations 表）
- **AND** 题外话**不**传递 `currentSessionId` 给后端
- **AND** 后端 `/api/aside/chat/stream` 接收 prompt 后**直接调 HermesExecutor.chat**（不走 session 上下文）
- **AND** 题外话关闭时**清空** `asideMessages` state（下次打开是空对话）

#### Scenario: 主任务不受影响
- **WHEN** 用户在题外话对话框中
- **THEN** 主对话流仍正常显示 / 滚动 / 自动滚动到底部
- **AND** 主对话 SSE 流未受影响（独立 EventSource / fetch）
- **AND** 题外话关闭后，主对话如有未完成流式响应仍继续

#### Scenario: 抽屉关闭
- **WHEN** 用户点击关闭按钮（X）或按 Esc
- **THEN** 抽屉滑出动画 `animate-slide-out-right`
- **AND** `asideMessages` state 清空
- **AND** 主对话状态完全不受影响

---

## MODIFIED Requirements

### Requirement: MessageBubble 代码块渲染（来自 frontend-system-beautification-doubao）
MessageBubble SHALL 用新建的 `CodeBlock` 组件替代内部 `<pre>` 渲染，AI 消息中的所有代码块自动获得工具栏能力。

#### Scenario: 替换渲染
- **WHEN** MessageBubble 渲染 AI 消息
- **THEN** 检测到代码块（```...```）时调用 `<CodeBlock language="..." code="..." />` 渲染
- **AND** CodeBlock 内部处理工具栏 / 运行 / 复制 / 保存 / diff 逻辑
- **AND** 保留 MessageBubble 已有功能：hover 工具栏、错误卡、AI 竖条

#### Scenario: 用户消息不受影响
- **WHEN** 渲染用户消息
- **THEN** 用户消息**不**调用 CodeBlock（用户消息的代码块无需工具栏），保留原 `<pre>` 简单渲染

---

### Requirement: BrandHeader 下拉菜单（来自 frontend-system-beautification-doubao）
BrandHeader 下拉菜单 SHALL 新增"片段库"入口（位于"用量监控"与"设置"之间）。

#### Scenario: 菜单扩展
- **WHEN** 渲染 BrandHeader 下拉菜单
- **THEN** 菜单项顺序：用量监控 → **片段库**（新增）→ 设置 → 回收站
- **AND** 点击"片段库"打开 SnippetLibrary modal

---

## REMOVED Requirements

无。本 spec 为增量改动，**不**删除已有功能。
