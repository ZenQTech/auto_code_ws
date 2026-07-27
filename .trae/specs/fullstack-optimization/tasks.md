# Tasks

## 执行顺序说明

模块 A~F 可并行执行，但每个模块内部的子任务按依赖顺序执行。建议按以下优先级：
- **P0（立即执行）**: 模块 A（前端 UI 交互）、模块 B（后端性能）
- **P1（架构重构）**: 模块 C（巨型文件拆分）
- **P2（功能增强）**: 模块 D（TRAE SOLO）、模块 E（Codex）
- **P3（基础设施）**: 模块 F（数据库/部署/路由/缓存）

---

## 模块 A：前端 UI 交互优化

- [ ] **Task A1**: ErrorBoundary 集成 + localStorage 安全
  - [ ] A1.1: 在 `main.tsx` 中导入 `ErrorBoundary` 并包裹 `<App />`
  - [ ] A1.2: 在 `App.tsx` 中补齐所有 `localStorage` 调用的 try-catch 包裹
  - [ ] **验证**: `npm run build` 成功；手动抛异常验证 ErrorBoundary 回退 UI

- [ ] **Task A2**: 请求防抖 + 操作按钮交互反馈
  - [ ] A2.1: 在 `App.tsx` 发送按钮添加 `isSending` + `abortControllerRef` 双重守卫
  - [ ] A2.2: 在 `Sidebar.tsx` 搜索输入框添加 300ms debounce（`useRef` + `setTimeout`）
  - [ ] A2.3: 检查所有 API 触发按钮，确保有 loading/disabled 状态
  - [ ] **验证**: 浏览器中快速连击发送按钮，确认仅触发一次；搜索框快速输入，确认仅最后一次触发 API

- [ ] **Task A3**: 骨架屏/加载态统一
  - [ ] A3.1: 为 `Sidebar`、`SettingsPanel`、`QuotaPanel` 等数据加载组件添加 PanelSkeleton
  - [ ] **验证**: 各面板数据加载时显示骨架屏而非空白

---

## 模块 B：后端性能优化

- [ ] **Task B1**: GZipMiddleware + 速率限制 + CORS + 健康检查
  - [ ] B1.1: 在 `main.py` 添加 `GZipMiddleware(minimum_size=500, compresslevel=4)`
  - [ ] B1.2: 为 `/api/hermes/chat`、`/api/hermes/chat/stream` 添加速率限制中间件（20 req/min/IP），超限返回 HTTP 429
  - [ ] B1.3: 修改 CORS 配置：`["*"]` 时打印 WARNING 日志，非 `*` 时使用配置值
  - [ ] B1.4: 扩展 `/health` 端点：增加 `SELECT 1` 数据库检查 + LLM API 可达性检查（超时 2s），返回结构化 JSON
  - [ ] **验证**: `curl -H "Accept-Encoding: gzip" localhost:8000/api/health` 验证压缩；`curl localhost:8000/health` 验证健康检查

- [ ] **Task B2**: WebSocket 按会话过滤 + SQLite WAL
  - [ ] B2.1: 在 `ws.py` 的 `ConnectionManager` 中新增 `_connections: Dict[str, Set[WebSocket]]` 按 session_id 分组
  - [ ] B2.2: `connect()` 接受可选 `session_id` 参数；`broadcast()` 改为 `broadcast_to(session_id, message)`
  - [ ] B2.3: 在 `database.py` 的 `init_db()` 中执行 `PRAGMA journal_mode=WAL`
  - [ ] **验证**: 同时打开两个会话，确认工作流状态更新仅推送到对应会话

- [ ] **Task B3**: 结构化日志 + Trace ID
  - [ ] B3.1: 在 `main.py` 添加中间件自动生成 `X-Request-ID`（UUID4），注入到响应头和日志上下文
  - [ ] B3.2: 配置 `python-json-logger` 输出 JSON 格式日志，包含 timestamp、level、module、request_id、message
  - [ ] **验证**: 发起请求后检查响应头含 `X-Request-ID`，日志文件为 JSON 格式

---

## 模块 C：架构重构 —— 巨型文件拆分

- [ ] **Task C1**: 拆分 `workflow_engine.py` (5236行)
  - [ ] C1.1: 创建 `backend/app/services/workflow/` 目录
  - [ ] C1.2: 提取公共工具函数到 `stage_common.py`（状态管理、阶段推进、错误处理等）
  - [ ] C1.3: 提取澄清阶段逻辑到 `stage_clarify.py`
  - [ ] C1.4: 提取架构设计阶段逻辑到 `stage_design.py`
  - [ ] C1.5: 提取提示词工程阶段逻辑到 `stage_prompting.py`
  - [ ] C1.6: 提取代码执行阶段逻辑到 `stage_execute.py`
  - [ ] C1.7: 提取质量评审阶段逻辑到 `stage_review.py`
  - [ ] C1.8: 重构 `engine.py` 为主入口，组合各阶段模块
  - [ ] C1.9: 更新所有 `from ..services.workflow_engine import` 引用为 `from ..services.workflow import`
  - [ ] **验证**: 后端启动无 ImportError；运行现有 E2E 测试确保工作流正常运行

- [ ] **Task C2**: 拆分 `App.tsx` (2044行)
  - [ ] C2.1: 创建 `frontend/src/components/chat/` 和 `frontend/src/components/workflow/` 目录
  - [ ] C2.2: 提取对话消息区逻辑到 `ChatView.tsx`
  - [ ] C2.3: 提取底部输入区逻辑到 `InputArea.tsx`
  - [ ] C2.4: 提取澄清流程管理到 `ClarificationHandler.tsx`
  - [ ] C2.5: 提取工作流阶段渲染到 `WorkflowStageRenderer.tsx`
  - [ ] C2.6: 提取架构设计阶段处理到 `DesignPhaseHandler.tsx`
  - [ ] C2.7: 精简 `App.tsx` 为根组件（仅路由 + 全局状态 + 组合子组件）
  - [ ] C2.8: 为每个子组件添加 `React.memo` + `useCallback` 优化
  - [ ] **验证**: `npm run build` 成功；前端功能正常

- [ ] **Task C3**: 拆分 `useApi.ts` (1564行)
  - [ ] C3.1: 创建 `frontend/src/hooks/useSessionsApi.ts`（会话 CRUD + 批量删除 + 回收站）
  - [ ] C3.2: 创建 `frontend/src/hooks/useHermesApi.ts`（聊天 + 流式 + 优化 + 停止）
  - [ ] C3.3: 创建 `frontend/src/hooks/useWorkflowApi.ts`（工作流 + 架构设计 + 代码审查）
  - [ ] C3.4: 创建 `frontend/src/hooks/useProjectApi.ts`（项目 + 文件 + 配置 + 统计）
  - [ ] C3.5: 精简 `useApi.ts` 为通用 `apiFetch` + 类型导出
  - [ ] C3.6: 更新所有组件中的 import 引用
  - [ ] **验证**: `npm run build` 成功；前端功能正常

---

## 模块 D：TRAE SOLO 核心能力整合

- [ ] **Task D1**: Plan 模式
  - [ ] D1.1: 后端新增 `PlanModeService`（`backend/app/services/plan_mode.py`）：生成结构化 Plan 文档、处理用户修改、确认后推进
  - [ ] D1.2: 后端新增 API 端点：`POST /api/workflow/{id}/plan/generate`、`POST /api/workflow/{id}/plan/confirm`
  - [ ] D1.3: 前端新增 `PlanViewer` 组件：展示任务拆解、执行步骤、涉及文件、风险点、替代方案
  - [ ] D1.4: 在 `DesignPhaseHandler` 中集成 Plan 确认流程
  - [ ] **验证**: 总架构师完成文档后，Plan 自动生成并展示；用户可确认或修改

- [ ] **Task D2**: SubAgent 上下文隔离
  - [ ] D2.1: 后端 `WorktreeManager` 增强：为每个 SubAgent 创建独立 Git Worktree
  - [ ] D2.2: `ClaudeCodeCLI` 执行器增强：传入 worktree 路径参数，确保文件隔离
  - [ ] D2.3: 前端 `WorkflowStageRenderer` 增强：展示各 SubAgent 独立工作区状态
  - [ ] **验证**: 3 个 SubAgent 同时工作，各自文件互不干扰

- [ ] **Task D3**: 三栏式 UI 界面
  - [ ] D3.1: 创建 `ThreePanelLayout` 组件：左栏（对话）、中栏（任务管理）、右栏（工具面板）
  - [ ] D3.2: 实现面板折叠/展开动画（CSS transition）
  - [ ] D3.3: 实现面板拖拽调整宽度（ResizeObserver）
  - [ ] D3.4: 响应式适配：小屏幕自动折叠为单栏 + 底部 Tab 切换
  - [ ] **验证**: 编程模式下默认三栏布局；可折叠/展开；拖拽调整宽度

- [ ] **Task D4**: 实时跟随模式
  - [ ] D4.1: 后端 SSE 事件增加 `stage` 字段，前端根据阶段自动切换右侧面板
  - [ ] D4.2: 阶段→面板映射：`designing`→编辑器、`executing`→终端、`reviewing`→DiffView、`preview`→内置浏览器
  - [ ] D4.3: 用户可手动切换面板（覆盖自动模式），再次点击"跟随"按钮恢复自动
  - [ ] **验证**: 工作流阶段切换时右侧面板自动切换

- [ ] **Task D5**: DiffView 增强
  - [ ] D5.1: 后端新增 `POST /api/git/diff-files` 端点：返回逐文件 diff 内容
  - [ ] D5.2: 前端增强 `GitPanel` 为 DiffView 组件：文件列表 + 逐文件 diff 视图 + 逐行折叠/展开
  - [ ] D5.3: 新增"保留"和"回退"按钮：调用 `git checkout -- <file>` 回退或 `git add <file>` 保留
  - [ ] **验证**: AI 生成代码后 DiffView 展示变更；可逐文件保留/回退

- [ ] **Task D6**: 对话节点自动折叠
  - [ ] D6.1: 在 `ChatView` 中实现节点折叠逻辑：SubAgent 完成时自动折叠为摘要
  - [ ] D6.2: 摘要卡片显示：任务名、状态（成功/失败/进行中）、耗时、文件变更数
  - [ ] D6.3: 点击摘要展开完整对话过程
  - [ ] **验证**: SubAgent 完成任务后对话节点自动折叠

- [ ] **Task D7**: WebSocket 双向同步
  - [ ] D7.1: 后端 WebSocket 新增 `code_stream` 事件类型：推送 token-by-token 代码生成
  - [ ] D7.2: 前端 `CodeViewer` 增强：接收 WebSocket 代码流，实时追加到编辑器
  - [ ] D7.3: 前端编辑器中修改代码后，通过 WebSocket 回传给 AI 作为上下文
  - [ ] **验证**: AI 生成代码时编辑器实时展示 token 流

- [ ] **Task D8**: 分步推理展示
  - [ ] D8.1: 后端 SSE 事件增加 `reasoning_stage` 字段：`analysis` / `planning` / `coding` / `testing`
  - [ ] D8.2: 前端 `ThinkingBlock` 增强：分阶段展示推理过程，每阶段带图标和进度条
  - [ ] D8.3: 用户可在任意阶段点击"干预"按钮暂停 AI 并输入修改建议
  - [ ] **验证**: AI 处理复杂任务时分阶段展示推理

---

## 模块 E：Codex 核心能力整合

- [ ] **Task E1**: 模型版本选择
  - [ ] E1.1: 后端新增 `ModelSelector` 服务：管理 Sol/Terra/Luna 三档模型配置
  - [ ] E1.2: 后端新增 `GET /api/models`、`POST /api/models/select` 端点
  - [ ] E1.3: 前端新增 `ModelSelector` 组件：下拉选择模型，显示当前模型和描述
  - [ ] E1.4: 在 `BrandHeader` 或 `SettingsPanel` 中集成模型选择器
  - [ ] **验证**: 切换模型后后续 LLM 调用使用选定模型

- [ ] **Task E2**: 推理强度调整
  - [ ] E2.1: 后端新增 `ReasoningIntensity` 配置：low/medium/high 映射到 temperature + max_tokens
  - [ ] E2.2: 前端新增强度滑块/选择器：low（快速）/ medium（均衡）/ high（深度）
  - [ ] E2.3: 在 `ModelSelector` 组件旁集成强度选择器
  - [ ] **验证**: 调整强度后 AI 回复详细程度变化

- [ ] **Task E3**: /review 命令
  - [ ] E3.1: 后端新增 `CodeReviewer` 服务：分析代码变更，识别安全漏洞/性能瓶颈/代码异味
  - [ ] E3.2: 后端新增 `POST /api/review` 端点：接收代码内容，返回结构化审查报告
  - [ ] E3.3: 前端聊天框支持 `/review` 命令解析：自动触发审查流程
  - [ ] E3.4: 前端新增 `ReviewReport` 增强：在 DiffView 中对应代码行挂出评论
  - [ ] **验证**: 输入 `/review` 后 AI 生成审查报告，问题在代码行上标注

- [ ] **Task E4**: /fix 命令
  - [ ] E4.1: 后端新增 `POST /api/fix` 端点：接收审查报告，自动修复问题
  - [ ] E4.2: 前端聊天框支持 `/fix` 命令：自动触发修复流程
  - [ ] E4.3: 修复完成后生成新的 DiffView 供用户确认
  - [ ] **验证**: 输入 `/fix` 后 AI 修复问题，DiffView 展示修复变更

- [ ] **Task E5**: 流式代码生成
  - [ ] E5.1: 后端 Claude Code CLI 执行器增加 SSE 输出：逐行/逐 token 推送代码生成
  - [ ] E5.2: 前端 `CodeViewer` 接收 SSE 流，实时追加到 Monaco Editor
  - [ ] E5.3: 区分"生成中"和"已完成"状态，完成后展示完整 DiffView
  - [ ] **验证**: AI 生成代码时编辑器实时展示生成过程

- [ ] **Task E6**: 代码审查-修复闭环
  - [ ] E6.1: 后端工作流引擎增加 `review_fix_loop` 阶段：代码生成 → 自动审查 → 自动修复 → 重新审查
  - [ ] E6.2: 配置最大迭代次数（默认 3 次），超过则标记为需人工介入
  - [ ] E6.3: 前端 `PipelineProgress` 增加闭环状态展示
  - [ ] **验证**: 代码生成后自动进入审查-修复循环，直到所有问题解决

---

## 模块 F：基础设施升级

- [ ] **Task F1**: SQLite → PostgreSQL 迁移
  - [ ] F1.1: 修改 `database.py`：支持 `DATABASE_URL` 环境变量切换 PostgreSQL
  - [ ] F1.2: 添加 `asyncpg` 和 `psycopg2` 依赖到 `requirements.txt`
  - [ ] F1.3: 修改 `init_db()` 中 SQLite 特有语法（`ALTER TABLE` 等）为条件兼容
  - [ ] F1.4: 提供数据迁移脚本 `scripts/migrate_sqlite_to_pg.py`
  - [ ] **验证**: 设置 `DATABASE_URL` 后使用 PostgreSQL；未设置时回退 SQLite

- [ ] **Task F2**: Docker 容器化部署
  - [ ] F2.1: 创建 `Dockerfile`：基于 `python:3.10-slim`，安装依赖，复制代码
  - [ ] F2.2: 创建 `docker-compose.yml`：定义 backend + postgres + nginx 服务
  - [ ] F2.3: 创建 `nginx.conf`：反向代理 + 静态文件服务 + gzip 压缩
  - [ ] F2.4: 创建 `.env.example`：环境变量模板
  - [ ] **验证**: `docker-compose up` 后所有服务正常启动

- [ ] **Task F3**: React Router 路由系统
  - [ ] F3.1: 安装 `react-router-dom` 依赖
  - [ ] F3.2: 在 `main.tsx` 中包裹 `BrowserRouter`
  - [ ] F3.3: 在 `App.tsx` 中定义路由：`/` → 重定向、`/chat` → 聊天模式、`/coding` → 编程模式、`/settings` → 设置、`/workflow/:id` → 工作流详情
  - [ ] F3.4: 侧边栏和模式切换改为 `navigate()` 调用
  - [ ] **验证**: 浏览器前进/后退正常；直接访问 `/coding` 可进入编程模式

- [ ] **Task F4**: API 响应缓存
  - [ ] F4.1: 为 `GET /api/stats/overview` 添加 `Cache-Control: max-age=30` 响应头
  - [ ] F4.2: 为 `GET /api/quota/overview` 添加 `Cache-Control: max-age=30` 响应头
  - [ ] F4.3: 为 `GET /api/config` 添加 `ETag` 支持
  - [ ] **验证**: 30 秒内重复请求统计接口，浏览器使用缓存

---

# Task Dependencies

```
模块 A (独立) ─────────────────────────────────────────────┐
模块 B (独立) ─────────────────────────────────────────────┤
模块 C (独立，但 C3 依赖 C2 的 import 路径) ───────────────┤
                                                           ├──> 并行执行
模块 D (独立，但 D3/D4/D5 依赖 C2 拆分后的组件结构) ──────┤
模块 E (独立，但 E5 依赖 D7 的 WebSocket 基础) ───────────┤
模块 F (独立，但 F1 依赖 C1 拆分后的模块结构) ─────────────┘
```

**关键依赖**：
- D3（三栏式 UI）应在 C2（App.tsx 拆分）之后执行，因为需要重构组件结构
- D5（DiffView 增强）应在 C2 之后执行，因为需要新的组件目录结构
- F1（PostgreSQL 迁移）应在 C1（workflow_engine 拆分）之后执行，因为需要更新数据库引用
- E5（流式代码生成）应在 D7（WebSocket 双向同步）之后执行，复用 WebSocket 基础