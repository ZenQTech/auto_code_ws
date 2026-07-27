# 全栈优化与 TRAE SOLO + Codex 功能整合 Spec

> **Spec 版本**: v2.0.0
> **创建日期**: 2026-07-24
> **参考文档**: `/home/qizheng/auto_code_ws/1.md` — TRAE SOLO与Codex的AI编程工作流对比分析
> **约束**: 保留现有 Loop Engineering 工作流核心逻辑，在此基础上增强和优化

## Why

在对项目 37 个前端组件、20 个 API 模块、50 个后端服务文件进行全面审查后，发现以下问题：
1. **前端 UI/UX 交互体验不足**：缺少错误边界保护、请求防抖、按钮交互反馈、骨架屏加载态统一
2. **后端性能瓶颈**：无响应压缩、无速率限制、WebSocket 无差别广播、SQLite 未开启 WAL、无结构化日志
3. **代码架构臃肿**：App.tsx(2044行)、useApi.ts(1564行)、workflow_engine.py(5236行) 等巨型文件难以维护
4. **缺少 TRAE SOLO 核心能力**：Plan 模式、SubAgent 上下文隔离、三栏式 UI、DiffView 增强、实时跟随模式、对话节点折叠
5. **缺少 Codex 核心能力**：模型版本选择、推理强度调整、/review /fix 命令、代码审查-修复闭环
6. **基础设施缺失**：无 Docker 部署、无 PostgreSQL 迁移方案、无 API 响应缓存、无 React Router

本 spec 将上述所有优化项整合为统一的全栈升级方案。

## What Changes

### 一、前端 UI 交互逻辑优化
- **ErrorBoundary 全局集成**：将已实现的 ErrorBoundary 包裹 `<App />`
- **请求防抖保护**：发送按钮、搜索输入添加 300ms debounce
- **操作按钮交互反馈**：所有 API 触发按钮添加 loading/disabled 状态
- **localStorage 安全包裹**：所有 localStorage 调用 try-catch 保护
- **骨架屏/加载态统一**：数据加载组件统一使用 PanelSkeleton

### 二、后端性能优化
- **GZipMiddleware 响应压缩**：> 500 字节的 JSON 响应自动压缩
- **API 速率限制**：LLM 端点 20 req/min/IP
- **WebSocket 按会话过滤**：避免无差别广播
- **健康检查细化**：检测数据库 + LLM API 可用性
- **CORS 环境感知**：开发环境警告，生产环境限制
- **SQLite WAL 模式**：开启 Write-Ahead Logging
- **结构化日志 + trace ID**：JSON 格式日志 + 请求追踪

### 三、架构重构：巨型文件拆分
- **workflow_engine.py (5236行) → 5 个阶段子模块**：clarify / design / prompt / execute / review
- **App.tsx (2044行) → 5 个子组件**：ChatView / InputArea / ClarificationHandler / WorkflowStageRenderer / DesignPhaseHandler
- **useApi.ts (1564行) → 5 个模块化 hooks**：useSessionsApi / useHermesApi / useWorkflowApi / useArchitectureApi / useProjectApi

### 四、TRAE SOLO 核心能力整合
- **Plan 模式**：AI 生成结构化任务计划（含拆解、执行步骤、涉及文件、风险点、替代方案），用户确认后执行
- **SubAgent 上下文隔离**：每个子智能体独立上下文空间，避免主 Agent 上下文污染
- **三栏式 UI 界面**：左栏对话面板 + 中栏任务管理面板 + 右栏工具面板（编辑器/浏览器/终端）
- **实时跟随模式**：根据 AI 工作阶段自动切换工具面板
- **DiffView 增强**：逐文件 diff 视图 + 逐行折叠/展开 + 保留/回退变更
- **对话节点自动折叠**：已完成子任务折叠为摘要，可展开查看完整过程
- **WebSocket 双向同步**：编辑器与 AI 实时双向同步
- **分步推理展示**：AI 分阶段输出思考过程（需求分析→计划制定→代码生成）

### 五、Codex 核心能力整合
- **模型版本选择**：支持 Sol(旗舰) / Terra(均衡) / Luna(快速) 三档模型切换
- **推理强度调整**：支持 low / medium / high 三档推理强度
- **/review 命令**：自动分析代码变更、识别潜在问题、生成审查评论
- **/fix 命令**：基于审查结果自动修复代码问题
- **流式代码生成**：token-by-token 实时展示代码生成过程
- **代码审查-修复闭环**：生成代码 → 自动审查 → 发现问题 → 自动修复 → 重新审查

### 六、基础设施升级
- **SQLite → PostgreSQL 迁移**：支持生产级并发写入
- **Docker 容器化部署**：Dockerfile + docker-compose.yml
- **React Router 路由系统**：模式切换 / 面板切换通过路由管理
- **API 响应缓存**：统计/配置/配额等低频端点添加 Cache-Control + ETag

---

## Impact

- Affected specs: 所有现有 spec（本 spec 为顶层全栈升级）
- Affected code:
  - `backend/app/main.py` — GZipMiddleware、速率限制、CORS、健康检查、结构化日志
  - `backend/app/database.py` — SQLite WAL + PostgreSQL 迁移支持
  - `backend/app/ws.py` — WebSocket 按会话过滤
  - `backend/app/services/workflow_engine.py` → `backend/app/services/workflow/` 拆分
  - `backend/app/services/` — 新增 plan_mode、code_reviewer、model_selector 服务
  - `backend/app/api/` — 新增 /review、/fix、/models 端点
  - `frontend/src/App.tsx` → 拆分为多个子组件
  - `frontend/src/hooks/useApi.ts` → 拆分为多个模块化 hooks
  - `frontend/src/main.tsx` — ErrorBoundary + React Router
  - `frontend/src/components/` — 新增三栏式布局、DiffView、PlanViewer、ModelSelector 等
  - `frontend/vite.config.ts` — vendor chunk 拆分
  - `frontend/tsconfig.json` — 死代码检查
  - `frontend/index.html` — meta 标签增强
  - `Dockerfile` + `docker-compose.yml` — 新增

---

## ADDED Requirements

---

### 模块 A：前端 UI 交互优化

#### Requirement A1: ErrorBoundary 全局兜底
系统 SHALL 在 `main.tsx` 中将 `ErrorBoundary` 组件包裹 `<App />`，确保任何未捕获异常不导致白屏。

**Scenario: 组件渲染异常**
- **WHEN** 某个子组件抛出未捕获异常
- **THEN** ErrorBoundary 捕获异常，显示友好回退 UI（含"刷新页面"按钮），其余组件不受影响

#### Requirement A2: 请求防抖保护
系统 SHALL 为高频用户操作添加 300ms debounce 保护。

**Scenario: 快速连击发送按钮**
- **WHEN** 用户在 300ms 内连续点击发送按钮 3 次
- **THEN** 仅第一次点击触发 API 请求，后续点击被忽略（按钮 disabled 状态）

**Scenario: 会话搜索输入**
- **WHEN** 用户在侧边栏搜索框快速输入
- **THEN** 搜索请求在用户停止输入 300ms 后才发送

#### Requirement A3: 操作按钮交互反馈
系统 SHALL 为所有触发 API 调用的按钮添加 loading/disabled 状态。

**Scenario: 发送消息按钮**
- **WHEN** 用户点击发送按钮
- **THEN** 按钮变为 disabled 状态 + 输入框 disabled，直到收到回复或超时

#### Requirement A4: localStorage 操作安全
系统 SHALL 对所有 `localStorage` 调用包裹 try-catch，防止隐私模式或存储配额满时抛出异常。

#### Requirement A5: 骨架屏/加载态统一
系统 SHALL 为所有数据加载组件统一使用 PanelSkeleton 骨架屏组件。

---

### 模块 B：后端性能优化

#### Requirement B1: API 响应压缩
系统 SHALL 在 FastAPI 中启用 GZipMiddleware，minimum_size=500，compresslevel=4。

**Scenario: 架构文档 API 响应**
- **WHEN** 前端请求 `/api/architecture/start-design-phase` 返回 > 10KB JSON
- **THEN** 响应被 gzip 压缩，传输体积减少 50-80%

#### Requirement B2: API 速率限制
系统 SHALL 为 `/api/hermes/chat/stream`、`/api/hermes/chat` 添加速率限制（默认 20 req/min/IP）。

**Scenario: 速率超限**
- **WHEN** 同一 IP 在 1 分钟内发送超过 20 次聊天请求
- **THEN** 返回 HTTP 429 + "请求过于频繁，请稍后再试"

#### Requirement B3: WebSocket 按会话过滤
系统 SHALL 将 `ConnectionManager` 改为按 `session_id`/`workflow_id` 分组广播。

**Scenario: 工作流状态更新**
- **WHEN** 工作流 A 的状态更新
- **THEN** 仅订阅了工作流 A 的客户端收到推送，其他客户端不受影响

#### Requirement B4: 健康检查细化
系统 SHALL 将 `/health` 端点扩展为同时检查数据库连接和 LLM API 可用性。

**Scenario: 所有依赖正常**
- **WHEN** 数据库连接正常 + LLM API 可达
- **THEN** 返回 HTTP 200 + `{"status": "healthy", "database": "ok", "llm_api": "ok"}`

**Scenario: 数据库不可用**
- **WHEN** 数据库连接失败
- **THEN** 返回 HTTP 503 + `{"status": "unhealthy", "database": "error"}`

#### Requirement B5: CORS 环境感知
系统 SHALL 根据 `settings.server.cors_origins` 限制 CORS 来源；`["*"]` 时打印 WARNING 日志。

#### Requirement B6: SQLite WAL 模式
系统 SHALL 在 `init_db()` 中执行 `PRAGMA journal_mode=WAL`，提升并发写入性能。

#### Requirement B7: 结构化日志 + Trace ID
系统 SHALL 使用 `python-json-logger` 输出 JSON 格式日志，每个请求自动生成 `X-Request-ID` 并在响应头和日志中关联。

---

### 模块 C：架构重构 —— 巨型文件拆分

#### Requirement C1: workflow_engine.py 拆分
系统 SHALL 将 `workflow_engine.py`(5236行) 拆分为 5 个阶段子模块：

```
backend/app/services/workflow/
├── __init__.py
├── engine.py              # 工作流引擎主入口 (~300行)
├── stage_clarify.py       # 需求澄清阶段 (~800行)
├── stage_design.py        # 架构设计阶段 (~900行)
├── stage_prompting.py     # 提示词工程阶段 (~800行)
├── stage_execute.py       # 代码执行阶段 (~900行)
├── stage_review.py        # 质量评审阶段 (~800行)
└── stage_common.py        # 阶段公共工具 (~500行)
```

**Scenario: 修改澄清阶段逻辑**
- **WHEN** 开发者需要修改需求澄清阶段的逻辑
- **THEN** 仅需修改 `stage_clarify.py`，无需理解其他 4000+ 行代码

#### Requirement C2: App.tsx 拆分
系统 SHALL 将 `App.tsx`(2044行) 拆分为 5 个子组件：

```
frontend/src/
├── App.tsx                    # 根组件，仅保留路由和全局状态 (~200行)
├── components/
│   ├── chat/
│   │   ├── ChatView.tsx       # 对话消息区 (~300行)
│   │   ├── InputArea.tsx      # 底部输入区 (~150行)
│   │   └── MessageBubble.tsx  # 消息气泡（已有）
│   ├── workflow/
│   │   ├── ClarificationHandler.tsx  # 澄清流程管理 (~250行)
│   │   ├── WorkflowStageRenderer.tsx # 工作流阶段渲染 (~200行)
│   │   └── DesignPhaseHandler.tsx    # 架构设计阶段处理 (~250行)
```

**Scenario: 修改输入框行为**
- **WHEN** 开发者需要修改输入框逻辑
- **THEN** 仅需修改 `InputArea.tsx`，不触碰其他 1800+ 行代码

#### Requirement C3: useApi.ts 拆分
系统 SHALL 将 `useApi.ts`(1564行) 拆分为 5 个模块化 hooks：

```
frontend/src/hooks/
├── useApi.ts              # 通用 fetch 封装 + apiFetch (~50行)
├── useSessionsApi.ts      # 会话 CRUD API (~300行)
├── useHermesApi.ts        # Hermes 聊天/流式 API (~400行)
├── useWorkflowApi.ts      # 工作流/架构设计 API (~400行)
└── useProjectApi.ts       # 项目/文件/配置 API (~400行)
```

**Scenario: 新增工作流 API**
- **WHEN** 开发者需要新增工作流相关 API 调用
- **THEN** 仅需在 `useWorkflowApi.ts` 中添加，不影响其他模块

---

### 模块 D：TRAE SOLO 核心能力整合

#### Requirement D1: Plan 模式
系统 SHALL 在代码生成阶段前增加 Plan 模式：AI 生成结构化任务计划（含任务拆解、执行步骤、涉及文件、风险点、替代方案），用户确认后方可执行。

**Scenario: 正常 Plan 流程**
- **WHEN** 总架构师完成 spec/task/checklist 文档生成后
- **THEN** AI 生成结构化 Plan 文档并在前端展示，用户可确认执行或修改计划

**Scenario: 用户修改 Plan**
- **WHEN** 用户对 Plan 中的某个任务有异议
- **THEN** 用户可在线编辑 Plan 内容，AI 根据修改重新调整

#### Requirement D2: SubAgent 上下文隔离
系统 SHALL 为每个 Claude Code CLI 子实例分配独立的上下文空间，通过 Git Worktree 实现物理隔离，避免主 Agent 上下文污染。

**Scenario: 多个 SubAgent 并行工作**
- **WHEN** 3 个 SubAgent 同时处理不同模块
- **THEN** 每个 SubAgent 在独立 Git Worktree 中工作，互不干扰，各自生成的文件不会冲突

#### Requirement D3: 三栏式 UI 界面
系统 SHALL 实现三栏式布局：左栏（对话面板）、中栏（任务管理面板）、右栏（工具面板）。

**Scenario: 三栏布局切换**
- **WHEN** 用户进入编程模式
- **THEN** 默认显示三栏布局：左侧显示 Agent 对话流，中间显示任务列表/进度，右侧显示代码编辑器/终端/浏览器预览

**Scenario: 折叠/展开面板**
- **WHEN** 用户点击折叠按钮
- **THEN** 对应面板收起为侧边图标，点击可重新展开

#### Requirement D4: 实时跟随模式
系统 SHALL 根据 AI 当前工作阶段自动切换右侧工具面板。

**Scenario: 阶段自动切换**
- **WHEN** AI 进入代码生成阶段
- **THEN** 右侧面板自动切换为代码编辑器
- **WHEN** AI 进入测试阶段
- **THEN** 右侧面板自动切换为终端面板
- **WHEN** AI 进入预览阶段（Web 项目）
- **THEN** 右侧面板自动切换为内置浏览器

#### Requirement D5: DiffView 增强
系统 SHALL 实现增强版 DiffView：逐文件展示变更 + 逐行折叠/展开 + 保留/回退操作按钮。

**Scenario: 查看代码变更**
- **WHEN** AI 完成代码生成后
- **THEN** DiffView 展示本次变更涉及的文件数量、变更行数、文件列表

**Scenario: 逐文件审查**
- **WHEN** 用户点击 DiffView 中的某个文件
- **THEN** 以 diff 视图展示具体变更，支持逐行折叠/展开

**Scenario: 保留/回退变更**
- **WHEN** 用户对某文件的变更不满意
- **THEN** 用户可点击"回退"按钮撤销该文件的所有变更，或点击"保留"确认变更

#### Requirement D6: 对话节点自动折叠
系统 SHALL 将已完成的子任务对话节点折叠为摘要，用户可点击展开查看完整过程。

**Scenario: 子任务完成**
- **WHEN** 某个 SubAgent 完成其分配的任务
- **THEN** 对话流中对应节点自动折叠为摘要（含任务名、状态、耗时），避免界面信息过载

#### Requirement D7: WebSocket 双向同步
系统 SHALL 通过 WebSocket 实现编辑器与 AI 的双向实时同步，确保代码生成、终端输出等操作的低延迟更新。

**Scenario: 实时代码生成展示**
- **WHEN** AI 正在生成代码
- **THEN** 编辑器实时展示代码的生成过程（token-by-token），而非一次性输出全部内容

#### Requirement D8: 分步推理展示
系统 SHALL 在对话面板中分阶段展示 AI 的思考过程：需求分析 → 计划制定 → 代码生成 → 测试验证。

**Scenario: 复杂任务推理**
- **WHEN** AI 处理复杂任务
- **THEN** 对话面板依次展示：① 需求分析结论 ② 制定计划 ③ 生成代码 ④ 测试验证结果，用户可在任意阶段干预

---

### 模块 E：Codex 核心能力整合

#### Requirement E1: 模型版本选择
系统 SHALL 支持用户选择 LLM 模型版本：Sol（旗舰，适合复杂任务）、Terra（均衡，日常主力）、Luna（快速，适合批量重复任务）。

**Scenario: 切换模型**
- **WHEN** 用户在设置面板或顶部栏选择模型
- **THEN** 后续所有 LLM 调用使用选定模型，选择立即生效

**Scenario: 模型自动推荐**
- **WHEN** 用户输入需求
- **THEN** 系统根据需求复杂度自动推荐合适的模型版本，用户可手动覆盖

#### Requirement E2: 推理强度调整
系统 SHALL 支持用户调整推理强度：low（快速响应）、medium（均衡）、high（深度推理）。

**Scenario: 调整推理强度**
- **WHEN** 用户将推理强度从 medium 调到 high
- **THEN** AI 在后续交互中提供更详细的分析和更多替代方案，响应时间相应增加

#### Requirement E3: /review 命令
系统 SHALL 支持 `/review` 命令触发自动代码审查：AI 分析代码变更、识别潜在问题（安全漏洞、性能瓶颈、代码异味）、生成审查评论。

**Scenario: 代码审查**
- **WHEN** 用户在聊天框输入 `/review` 或点击审查按钮
- **THEN** AI 自动分析当前工作区代码变更，生成结构化审查报告（含问题分类、严重程度、修复建议）

**Scenario: PR 风格审查**
- **WHEN** 审查完成
- **THEN** 在 DiffView 中对应代码行上挂出评论，用户可逐条处理

#### Requirement E4: /fix 命令
系统 SHALL 支持 `/fix` 命令触发自动修复：基于审查结果自动修复代码问题。

**Scenario: 自动修复**
- **WHEN** 用户在审查报告中点击"修复"或输入 `/fix`
- **THEN** AI 尝试自动修复所有标记的问题，修复后生成新的 DiffView 供用户确认

#### Requirement E5: 流式代码生成
系统 SHALL 通过 SSE/WebSocket 实现 token-by-token 流式代码生成，在编辑器中实时展示。

**Scenario: 实时代码输出**
- **WHEN** AI 开始生成代码文件
- **THEN** 代码编辑器逐 token 展示生成内容，用户可实时查看生成进度

#### Requirement E6: 代码审查-修复闭环
系统 SHALL 实现完整的 "生成代码 → 自动审查 → 发现问题 → 自动修复 → 重新审查" 闭环。

**Scenario: 闭环自动执行**
- **WHEN** AI 完成代码生成后
- **THEN** 自动触发审查流程：① 安全扫描 ② 代码规范检查 ③ 性能分析
- **WHEN** 审查发现问题
- **THEN** 自动触发修复流程，修复后重新审查，直到所有问题解决或达到最大迭代次数

---

### 模块 F：基础设施升级

#### Requirement F1: SQLite → PostgreSQL 迁移
系统 SHALL 支持 PostgreSQL 作为主存储引擎，同时保持 SQLite 兼容（通过环境变量切换）。

**Scenario: 生产环境部署**
- **WHEN** 设置 `DATABASE_URL=postgresql+asyncpg://...`
- **THEN** 系统使用 PostgreSQL 连接，支持高并发写入

**Scenario: 开发环境**
- **WHEN** 未设置 `DATABASE_URL`
- **THEN** 系统回退到 SQLite（WAL 模式），保持零配置开发体验

#### Requirement F2: Docker 容器化部署
系统 SHALL 提供 `Dockerfile` 和 `docker-compose.yml`，支持一键部署。

**Scenario: 一键部署**
- **WHEN** 用户执行 `docker-compose up`
- **THEN** 系统自动启动 FastAPI 后端 + PostgreSQL 数据库 + Nginx 前端，全部服务就绪

#### Requirement F3: React Router 路由系统
系统 SHALL 引入 React Router 管理前端路由：`/chat`（聊天模式）、`/coding`（编程模式）、`/settings`（设置）、`/workflow/:id`（工作流详情）。

**Scenario: 浏览器前进/后退**
- **WHEN** 用户从编程模式切换到聊天模式
- **THEN** 浏览器 URL 变为 `/chat`，可按浏览器后退按钮回到编程模式

#### Requirement F4: API 响应缓存
系统 SHALL 为低频变更端点（统计、配置、配额）添加 `Cache-Control: max-age=30` 和 ETag 支持。

**Scenario: 统计页面刷新**
- **WHEN** 用户在 30 秒内多次刷新统计页面
- **THEN** 浏览器使用缓存响应，不重新请求后端，减少服务器负载

---

## MODIFIED Requirements

### Requirement M1: 保留现有工作流核心逻辑
现有 Loop Engineering 工作流（需求澄清→架构设计→提示词工程→代码执行→质量评审→迭代闭环）的核心逻辑保持不变，仅在其基础上增加 Plan 模式、SubAgent 上下文隔离等增强功能。

---

## REMOVED Requirements

无（不删除现有功能）。

---

## 不做的事项（明确排除）

- ❌ 不修改现有工作流阶段转换逻辑（clarifying → designing → prompting → executing → reviewing）
- ❌ 不删除或替换现有 Agent 角色（总架构师、质量保障、批判反思、提示词优化）
- ❌ 不修改现有 API 接口签名（向后兼容）
- ❌ 不实现语音输入（超出范围）
- ❌ 不实现 MCP 协议（超出范围）
- ❌ 不实现多 LLM Provider 抽象（仅支持用户修改 API key）
- ❌ 不实现企业级 RBAC（超出范围）
- ❌ 不实现 Slack/Linear 集成（超出范围）