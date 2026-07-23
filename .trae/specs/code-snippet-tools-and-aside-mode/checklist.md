# Checklist

## Part A: 代码片段工具

### Task 1 — 后端 Snippet 模型 + API
- [ ] `Snippet` ORM 已新增（id / title / description / language / code / tags / created_at）
- [ ] snippets 表迁移已添加
- [ ] `GET / POST / DELETE /api/snippets` 端点已实现
- [ ] snippets_router 已注册

### Task 2 — 后端代码运行端点
- [ ] `POST /api/code/run` 端点已实现
- [ ] Node.js sandbox（subprocess.Popen + 5s 超时）
- [ ] 仅支持 javascript / typescript / node
- [ ] 返回 `{stdout, stderr, exit_code, duration_ms}`

### Task 3 — 前端类型与 hooks
- [ ] `Snippet` / `CodeExecutionResult` / `DiffLine` / `AsideMessage` 类型已定义
- [ ] `useSnippets` / `createSnippet` / `deleteSnippet` hooks 已实现
- [ ] `runCode` hook 已实现
- [ ] `asideChatStreaming` hook 已实现

### Task 4 — CodeBlock 组件
- [ ] `CodeBlock.tsx` 已新建
- [ ] 4 按钮工具栏：复制 / 运行 / 保存 / diff
- [ ] hover 浮出动画
- [ ] 复制 + Check icon 反馈
- [ ] 运行 + 执行结果卡片
- [ ] 保存 + diff 回调

### Task 5 — SnippetLibrary 弹窗
- [ ] `SnippetLibrary.tsx` 已新建
- [ ] 3 种模式：list / save / diff-select
- [ ] 列表搜索 / 复制 / diff / 删除
- [ ] 保存表单：title / description / language / tags

### Task 6 — DiffViewer 组件
- [ ] `DiffViewer.tsx` 已新建
- [ ] line-by-line diff 算法
- [ ] 绿色 + / 红色 - / 灰色上下文渲染
- [ ] font-mono + 行号

### Task 7 — MessageBubble 集成 CodeBlock
- [ ] `MessageBubble.tsx` v1.0.0 → v1.1.0
- [ ] AI 消息代码块用 CodeBlock 渲染
- [ ] 文本块仍用纯文本渲染
- [ ] 用户消息保持原样

### Task 8 — App.tsx 集成 Part A
- [ ] `App.tsx` v2.9.3 → v2.10.0
- [ ] SnippetLibrary 弹窗受控 state
- [ ] DiffViewer 受控 state
- [ ] BrandHeader `onOpenSnippets` 回调
- [ ] 下拉菜单"片段库"入口

## Part B: 题外话模式

### Task 9 — 后端题外话端点
- [ ] `aside.py` 已新建
- [ ] `POST /api/aside/chat/stream` SSE 端点
- [ ] 不接收 session_id，不写 conversations
- [ ] 直接调 HermesExecutor.chat_streaming
- [ ] SSE 事件流：text / done / error
- [ ] aside_router 已注册

### Task 10 — AsideDrawer 组件
- [ ] `AsideDrawer.tsx` 已新建
- [ ] 右侧滑出抽屉 360px
- [ ] 独立 asideMessages / asideInputValue state
- [ ] 独立消息流：用户右对齐 / AI 左对齐
- [ ] 独立输入框 + Enter 发送
- [ ] asideChatStreaming 集成
- [ ] 滑入/滑出动画
- [ ] 关闭时清空 asideMessages

### Task 11 — App.tsx 集成 Part B
- [ ] asideDrawerOpen state 已新增
- [ ] FAB 按钮（fixed bottom-32 right-6 z-40）
- [ ] FAB 条件显示：isSending 或 displayAgents running
- [ ] FAB 样式：圆形渐变 + glow-hermes
- [ ] AsideDrawer 受控集成

## Part C: 构建与回归

### Task 12 — 构建与回归验证
- [ ] 后端启动无报错
- [ ] 前端构建无编译错误
- [ ] grep 验证 4 个前端新文件：CodeBlock / SnippetLibrary / DiffViewer / AsideDrawer
- [ ] grep 验证 3 个后端新文件：snippets.py / aside.py / code.py
- [ ] GUI 端到端：代码块工具栏 hover / 运行 Node.js / 保存片段 / diff 对比 / FAB 显示 / AsideDrawer 隔离
- [ ] 题外话不写入主 messages state（隔离验证）
