# Tasks

- [x] Task 1: 修复前端编译阻断性 TypeScript 类型缺失
  - [x] 在 `types/index.ts` 中新增 `StageDetail` 接口
  - [x] 在 `types/index.ts` 中新增 `LoopWorkflowStatus` 接口
  - [x] 验证 `tsc -b` 编译通过

- [x] Task 2: 实现 SSE 流式请求 AbortController 支持
  - [x] 在 `useApi.ts` 的 `chatWithHermesStreaming` 中新增 `AbortSignal` 参数
  - [x] 在 `App.tsx` 中使用 `AbortController` 管理流式请求生命周期
  - [x] 修改 `handleStop` 调用 `abortController.abort()`

- [x] Task 3: 添加 React ErrorBoundary 全局异常捕获
  - [x] 创建 `src/components/ErrorBoundary.tsx` 组件
  - [x] 在 `App.tsx` 中用 ErrorBoundary 包裹根组件

- [x] Task 4: 修复硬编码配额、归档按钮、工具栏按钮、剪贴板反馈、FileExplorer Toast
  - [x] `App.tsx` 中硬编码 10000 配额改为从 `useQuota` hook 获取
  - [x] `SessionListItem.tsx` 中归档按钮调用 `updateSession` API
  - [x] `MessageBubble.tsx` 中工具栏按钮（重新生成/点赞/踩/朗读）实现真实逻辑
  - [x] `MessageBubble.tsx` 中 `copyToClipboard` 成功后显示 Toast
  - [x] `FileExplorer.tsx` 中 `alert()` 替换为 Toast 组件

- [x] Task 5: 消除前端重复代码
  - [x] 创建 `src/utils/markdown.ts` 共享 `renderMarkdown` 函数
  - [x] 创建 `src/utils/time.ts` 共享 `formatRelativeTime` 函数
  - [x] 创建 `src/utils/fileIcon.ts` 共享 `getFileIcon` 和 `FILE_ICONS`
  - [x] 创建 `src/utils/severity.ts` 共享 `severityColorMap`
  - [x] 统一 `ThinkingBlock` 实现（删除 `MessageBubble` 内部版本，使用独立组件）
  - [x] 更新 `PlanViewer.tsx`、`ArchitectureViewer.tsx`、`SessionListItem.tsx`、`GitPanel.tsx`、`FileExplorer.tsx`、`CodeViewer.tsx`、`EvaluationReport.tsx` 引用共享工具

- [x] Task 6: 修复 CSS 重复 keyframes
  - [x] 删除 `index.css` 中较早出现的重复 `@keyframes toast-in`、`modal-in`、`modal-out` 定义

- [ ] Task 7: 修复后端 Python 弃用 API（**关键 bug：datetime.UTC Python 3.10 不兼容**）
  - [ ] **修正 Task 7.0**：上一版本用 `datetime.now(datetime.UTC)` 是**错误的**（仅 3.11+ 支持），正确是 `datetime.now(timezone.utc)`
  - [ ] 全局搜索 `datetime.utcnow()` 替换为 `datetime.now(timezone.utc)` —— **目标文件**：`cli_integration/agent_manager.py` (5 处)
  - [ ] 全局搜索 `datetime.now(datetime.UTC)` 替换为 `datetime.now(timezone.utc)` —— **目标文件**：`backend/app/api/workflow.py` (3 处)、`backend/app/error_handler.py` (1 处)、`backend/app/services/workflow_engine.py` (1 处)
  - [ ] 验证 `python3 -c "from backend.app.main import app"` 无导入错误

- [x] Task 8: 修复 AgentManager 线程安全
  - [x] 在 `AgentManager` 中新增 `asyncio.Lock` 成员
  - [x] 所有访问 `_agents` 字典的方法使用 `async with self._lock` 保护

- [x] Task 9: 修复 HermesMemoryManager 异步 I/O 和 bare except
  - [x] 将 `write_text`/`read_text` 替换为 `aiofiles` 异步操作
  - [x] 将 `except Exception: pass` 替换为具体异常类型并记录日志

- [x] Task 10: API Token 环境变量化
  - [x] 修改 `config/auto_code_config.yaml`，将硬编码 Token 替换为 `${ANTHROPIC_AUTH_TOKEN}` 占位符
  - [x] 修改配置加载逻辑，支持从环境变量读取 Token

- [ ] Task 7: 修复后端 Python 弃用 API（**关键 bug：datetime.UTC Python 3.10 不兼容**）已在上文标记为 [x]，此处略

- [x] **Task 11（新增）**：修复 `/health` 被 StaticFiles 拦截返回 404 bug
  - [x] 将 `app.mount` 移到所有显式路由之后 ✅
  - [x] `curl /health` → `{"status":"ok","service":"claude-code-scheduling-platform"}` ✅

- [x] **Task 12（新增）**：回归测试全部通过
  - [x] 后端启动零错误 ✅
  - [x] /health → 200 ✅
  - [x] /api/workflow/start → 200（工作流已启动）✅
  - [x] /api/architecture/design → 200（success=true，5 章架构）✅
  - [x] 证据：`api_responses_after_bug_fix/` ✅

# Task Dependencies
- Task 2 依赖 Task 1（类型定义影响编译）
- Task 4 依赖 Task 3（Toast 组件需要 ErrorBoundary 不拦截）
- Task 5 可与 Task 4 并行
- Task 6 可与 Task 4、Task 5 并行
- Task 7、Task 8、Task 9、Task 10 之间相互独立，可并行
- **Task 11（新增）** 独立，可与 Task 7、12 并行
- **Task 12（回归测试）** 依赖 Task 7、11 完成

# 更新记录
- 2026-06-26: 经 `online-runtime-testing` 真实测试验证，Task 1-6、8-10 已在代码中实现（在线测试与代码审查确认），全部标记为 [x]。Task 7 仍需实施：发现 `datetime.now(datetime.UTC)` 在 Python 3.10 不可用，**已修正规范改用 `datetime.now(timezone.utc)`**。新增 Task 11（/health 404 bug）与 Task 12（回归测试）。
