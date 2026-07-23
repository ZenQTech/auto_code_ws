# Tasks

## Part A: 代码片段工具（核心）

- [ ] Task 1: 后端 Snippet 模型 + API
  - 1.1 在 `backend/app/models.py` v1.7.0 → v1.8.0 新增 `Snippet` ORM（id / title / description / language / code / tags / created_at）
  - 1.2 在 `backend/app/database.py` v1.3.0 → v1.4.0 snippets 表迁移（init_db + legacy migration）
  - 1.3 新建 `backend/app/api/snippets.py` v1.0.0：CRUD 端点（GET / POST / DELETE `/api/snippets`）
  - 1.4 在 `backend/app/api/__init__.py` v1.2.0 → v1.3.0 注册 snippets_router
  - 1.5 文件头修改记录已写入

- [ ] Task 2: 后端代码运行端点
  - 2.1 新建 `backend/app/api/code.py` v1.0.0：`POST /api/code/run` 接收 `{language, code}` → Node.js sandbox 执行 → 返回 `{stdout, stderr, exit_code, duration_ms}`
  - 2.2 使用 `subprocess.Popen` + `subprocess.PIPE`，超时 5s 自动 kill
  - 2.3 仅支持 `javascript` / `typescript` / `node`，其他语言返回 400 "暂不支持该语言"
  - 2.4 在 `backend/app/api/__init__.py` v1.3.0 注册 code_router
  - 2.5 文件头修改记录

- [ ] Task 3: 前端类型与 hooks
  - 3.1 在 `frontend/src/types/index.ts` v1.5.0 → v1.6.0 新增 `Snippet` / `CodeExecutionResult` / `DiffLine` / `AsideMessage` 类型
  - 3.2 在 `frontend/src/hooks/useApi.ts` v1.4.0 → v1.5.0 新增 hooks：
    - `useSnippets()` — GET 列表
    - `createSnippet(payload)` — POST
    - `deleteSnippet(id)` — DELETE
    - `runCode(language, code)` — POST /api/code/run
    - `asideChatStreaming(prompt, onEvent)` — POST /api/aside/chat/stream（独立 EventSource）
  - 3.3 文件头修改记录

- [ ] Task 4: CodeBlock 组件
  - 4.1 新建 `frontend/src/components/CodeBlock.tsx` v1.0.0
  - 4.2 Props: `language: string; code: string;` + 可选 `onSave?: (snippet) => void`
  - 4.3 实现 4 按钮工具栏：复制 / 运行 / 保存 / diff（hover 浮出，absolute top-2 right-2）
  - 4.4 复制：navigator.clipboard.writeText + Check icon 反馈 1.5s
  - 4.5 运行：调 `runCode` → 展开执行结果卡片（max-h-40 overflow-auto）
  - 4.6 保存：调 `onSave` 回调（父组件 SnippetLibrary modal 处理）
  - 4.7 diff：调 `onDiff` 回调（父组件 DiffViewer 处理）
  - 4.8 文件头 v1.0.0 修改记录

- [ ] Task 5: SnippetLibrary 片段库弹窗
  - 5.1 新建 `frontend/src/components/SnippetLibrary.tsx` v1.0.0
  - 5.2 Props: `isOpen: boolean; onClose: () => void; mode: 'list' | 'save' | 'diff-select'; initialSnippet?: {language, code}; onSelect?: (snippet) => void;`
  - 5.3 list 模式：片段列表（搜索 / 复制 / diff / 删除）
  - 5.4 save 模式：保存表单（title / description / language / tags）
  - 5.5 diff-select 模式：选择某条片段做 diff
  - 5.6 文件头 v1.0.0

- [ ] Task 6: DiffViewer 组件
  - 6.1 新建 `frontend/src/components/DiffViewer.tsx` v1.0.0
  - 6.2 Props: `oldCode: string; newCode: string; oldLabel?: string; newLabel?: string; onClose: () => void;`
  - 6.3 使用简单的 line-by-line diff（无需 diff 库，按行 split + 简单 LCS 算法）
  - 6.4 渲染统一 diff 视图：绿色 `+` 行 / 红色 `-` 行 / 灰色上下文行
  - 6.5 字体 `font-mono text-xs`，行号左对齐
  - 6.6 文件头 v1.0.0

- [ ] Task 7: MessageBubble 集成 CodeBlock
  - 7.1 在 `frontend/src/components/MessageBubble.tsx` v1.0.0 → v1.1.0 把 AI 消息内的 `<pre>` 替换为 `<CodeBlock language={...} code={...} onSave={...} onDiff={...} />`
  - 7.2 通过简单正则 ` ```(\w+)?\n([\s\S]+?)\n``` ` 拆分代码块与文本块
  - 7.3 文本块仍用纯文本渲染（保留 markdown 风格）
  - 7.4 用户消息**不**调用 CodeBlock（保持原样）
  - 7.5 文件头 v1.1.0 修改记录

- [ ] Task 8: App.tsx 集成 + BrandHeader 菜单
  - 8.1 在 `frontend/src/App.tsx` v2.9.3 → v2.10.0 新增 state：`snippetLibraryOpen` / `snippetLibraryMode` / `diffViewerState`
  - 8.2 集成 SnippetLibrary 弹窗（受控 isOpen / mode）
  - 8.3 集成 DiffViewer（受控 isOpen / oldCode / newCode）
  - 8.4 BrandHeader 接受 `onOpenSnippets` 回调，App.tsx 传 `setSnippetLibraryOpen(true) + setSnippetLibraryMode('list')`
  - 8.5 BrandHeader 下拉菜单新增"片段库"入口（位于用量监控之后、设置之前）
  - 8.6 文件头 v2.10.0 修改记录

## Part B: 题外话模式（补充）

- [ ] Task 9: 后端题外话端点
  - 9.1 新建 `backend/app/api/aside.py` v1.0.0：`POST /api/aside/chat/stream` SSE 端点
  - 9.2 接收 `{prompt: str}`，**不**接收 session_id
  - 9.3 直接调 `HermesExecutor.chat_streaming(prompt)`（**不**经过 HermesService / 不写 conversations）
  - 9.4 SSE 事件流：`{type: "text", content: "..."}` / `{type: "done"}` / `{type: "error", message: "..."}`
  - 9.5 在 `backend/app/api/__init__.py` v1.3.0 注册 aside_router（prefix="/aside"）
  - 9.6 文件头 v1.0.0

- [ ] Task 10: AsideDrawer 组件
  - 10.1 新建 `frontend/src/components/AsideDrawer.tsx` v1.0.0
  - 10.2 Props: `isOpen: boolean; onClose: () => void;` + 内部 state（asideMessages / asideInputValue / isSending / streamingMessageId）
  - 10.3 右侧滑出抽屉：`fixed right-0 top-0 bottom-0 w-[360px] z-50 bg-white/95 backdrop-blur-md shadow-level-4`
  - 10.4 顶部"题外话"标题 + 关闭按钮（X icon）
  - 10.5 独立消息流（asideMessages）：用户消息暖橙右对齐、AI 消息白卡左对齐
  - 10.6 独立输入框：textarea + 发送按钮，Enter 发送
  - 10.7 发送时调 `asideChatStreaming(prompt, {onText, onDone, onError})`
  - 10.8 滑入/滑出动画 `animate-slide-in-right` / `animate-slide-out-right`
  - 10.9 关闭时清空 asideMessages
  - 10.10 文件头 v1.0.0

- [ ] Task 11: App.tsx 集成 FAB + AsideDrawer
  - 11.1 在 `App.tsx` v2.10.0 新增 state：`asideDrawerOpen` / `asideMessages`
  - 11.2 新增 FAB 按钮（fixed bottom-32 right-6 z-40）：当 `isSending || displayAgents.some(a => a.status === 'running')` 时显示
  - 11.3 FAB 样式：`w-14 h-14 rounded-full bg-gradient-to-br from-hermes-500 to-hermes-600 text-white shadow-glow-hermes`
  - 11.4 FAB 点击：setAsideDrawerOpen(true)
  - 11.5 AsideDrawer 集成：受控 isOpen / onClose
  - 11.6 文件头 v2.10.0（Part B 改造追加记录）

## Part C: 构建与回归

- [ ] Task 12: 构建与回归验证
  - 12.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错
  - 12.2 前端 `npm run build` 无编译错误
  - 12.3 grep 验证 4 个新文件已建：CodeBlock / SnippetLibrary / DiffViewer / AsideDrawer
  - 12.4 grep 验证 2 个新后端文件已建：snippets.py / aside.py / code.py
  - 12.5 GUI 端到端：代码块工具栏 hover / 运行 Node.js / 保存片段 / diff 对比 / FAB 显示 / AsideDrawer 隔离
  - 12.6 验证：题外话不写入主 messages state（与主对话完全隔离）

# Task Dependencies
- Part A:
  - Task 1（后端 Snippet）独立
  - Task 2（后端 code run）独立
  - Task 3（前端类型 hooks）依赖 Task 1 + 2
  - Task 4（CodeBlock）依赖 Task 3
  - Task 5（SnippetLibrary）依赖 Task 3
  - Task 6（DiffViewer）独立
  - Task 7（MessageBubble 集成）依赖 Task 4
  - Task 8（App.tsx 集成 Part A）依赖 Task 5 + 6 + 7
- Part B:
  - Task 9（后端 aside）独立
  - Task 10（AsideDrawer）依赖 Task 9 + Task 3
  - Task 11（App.tsx 集成 Part B）依赖 Task 10
- Part C 依赖全部
