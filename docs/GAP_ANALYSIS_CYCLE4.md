# CYCLE 4 GAP ANALYSIS — 功能差距分析报告

> 分析时间：2026-07-27
> 分析依据：CYCLE4_RESEARCH_REPORT.md（Codex v0.145+ / TRAE SOLO v3.6+ 调研）
> 目的：基于最新调研结果，识别本平台未实现的关键功能，规划 Cycle 4 实施任务

---

## 一、差距矩阵

| 维度 | 目标能力 | 本平台当前实现 | 差距评估 | 优先级 |
|---|---|---|---|---|
| **MCP SSE Transport** | 真正的 SSE 客户端（GET 订阅 + POST 发送） | `StreamableHTTPMCPServer` 实际只实现 `urllib.request` 同步 HTTP；SSE 模式退化 | ⚠️ 严重：MCP 远程生态扩展受限 | **P0** |
| **MCP HTTP Headers OAuth** | OAuth 2.1 + Bearer Token | 仅支持任意 headers | ⚠️ 中：缺少标准 OAuth 流程 | P1 |
| **Plan Mode UI** | Plan 增删/调整 UI + 风险点展示 | 后端完整（generate/confirm/modify/reject），前端无编辑 UI | ⚠️ 高：闭环 Plan 模式 | **P0** |
| **Plan Mode 持久化恢复** | reload workflow 后恢复 Plan | 数据库持久化已有 | ✅ 已有 | - |
| **Hook 事件完整化** | 10 事件（PreToolUse/PostToolUse/PreCompact/...） | 仅 Task 完成 hook | ⚠️ 高：精细化控制缺失 | **P0** |
| **SubAgent Memory Inheritance** | 子 Agent 独立 context + 记忆继承 | SubAgent workspace 前端展示；无独立 context | ⚠️ 高：subagent 真正独立 | **P0** |
| **ChatView 组件独立** | 消息渲染从 App.tsx 抽出 | App.tsx 1931 行（v4.3.0 后 1618→1931 反弹） | ⚠️ 中：可维护性下降 | **P0** |
| **TRACE Correction→Enforcement** | 用户纠正编译为规则 | 仅多层规则合并 | ⚠️ 高：缺自动 enforcement | P1 |
| **Starlark execution policy** | 命令前缀规则匹配 | 不适用（本平台非 CLI 工具） | ⏸️ 低：可跳过 | - |
| **会话 Archive/Fork** | archive/unarchive + fork | 仅 compaction | ⚠️ 中：可后续补 | P1 |
| **Codex mem0 memory** | 跨 session 知识库 | 4 级 AGENTS.md 加载 | ⚠️ 中：缺主动检索 | P1 |
| **Worktree per task** | 每个任务独立 Git | 单一 git 仓库 | ⚠️ 中：subagent 独立环境缺失 | P1 |
| **JSONL Event Stream** | `codex exec` JSONL output | SSE 流式 | ✅ 已有 | - |
| **Realtime WebSocket** | Frameless bidirectional | HTTP SSE | ⏸️ 低 | - |
| **语音输入** | TRAE 语音交互 | 不支持 | ⏸️ 中：非核心 | P2 |
| **Global Memory 整合** | 跨所有过去交互 | 4 级 AGENTS.md | ⚠️ 中 | P1 |
| **Figma to code** | 设计稿 → 代码 | 不支持 | ⏸️ 低 | P2 |
| **TRAE Worktree 隔离** | 每个任务独立 Git | 单一 git 仓库 | ⚠️ 中 | P1 |

---

## 二、Cycle 4 P0 任务（核心交付）

### P0-1：MCP SSE Transport 真实实现

**当前问题**：
- `MCPTransport.SSE` 枚举已定义
- `StreamableHTTPMCPServer._send_http` 使用 `urllib.request.urlopen`，**不是真正的 SSE**
- SSE 模式（deprecated）应实现：`GET {url}` 订阅事件流 + `POST {message_url}` 发送请求

**实现方案**：
1. 创建 `backend/app/services/mcp/sse_transport.py`
2. 使用 `httpx-sse` 或原生 `aiohttp` 实现 SSE 客户端
3. 拆分 `_send_http` → 适配三种模式：
   - `streamable_http`: 单次 POST → JSON 响应
   - `sse`: POST 发送请求 + GET 接收 SSE 流
4. 添加 `MCPTransport` 文档说明三种模式
5. SSE 心跳保活（last_event_id 重连）

**验收标准**：
- [ ] SSE 模式能订阅远程 MCP server 的事件
- [ ] SSE 模式能发送 JSON-RPC 请求并接收响应
- [ ] 三种传输模式在配置和调用时表现一致
- [ ] 添加单元测试 + E2E 测试（使用 mock SSE server）
- [ ] 文档：API doc + README

**参考依据**：[Codex v0.145+ Remote MCP server configuration](https://techdevnotes.com/releases/codex-cli/0.145.0-alpha.14)

---

### P0-2：Plan Mode 完整化 - Plan 增删/调整 UI + Rollback 链路

**当前状态**：
- 后端完整：generate / confirm / modify / reject 5 个端点
- 前端：`ArchitectureDesignModal` 仅展示 spec，**无 Plan 增删/调整 UI**

**实现方案**：
1. 新建 `frontend/src/components/PlanEditor.tsx`
2. 支持 Plan 列表可视化：阶段 → 任务 → 风险点
3. 支持 inline 编辑：增删阶段、调整顺序、修改任务
4. 风险点显示（warning badge + 详情弹窗）
5. 文件修改预览（diff view）
6. 集成 ArchitectureDesignModal 流程

**Rollback 链路**：
1. Plan 阶段生成 git snapshot（commit 标记 `plan-pending`）
2. 用户拒绝 Plan → 触发 rollback
3. 用户修改 Plan → 重新生成 → 新 snapshot
4. 用户确认 Plan → 标记 `plan-confirmed` → 后续基于此 commit

**验收标准**：
- [ ] Plan 增删/调整 UI 可用
- [ ] 风险点高亮显示
- [ ] Rollback 链路可工作
- [ ] 单元测试 + E2E 测试

**参考依据**：[TRAE SOLO Plan Mode](https://test-news.aibase.com/news/23153)

---

### P0-3：Hook 事件完整化（10 事件对齐 Codex）

**当前状态**：
- 仅 `Task 完成 hook` 触发 git commit
- 其他 9 个事件未实现

**实现方案**：
1. 在 `commit_hook_handler.py` 基础上扩展为 `lifecycle_hooks.py`
2. 实现事件类型（参考 Codex）：
   - `SessionStart` / `SessionEnd`
   - `SubagentStart` / `SubagentStop`
   - `PreToolUse` (可阻断) / `PostToolUse`
   - `PreCompact` / `PostCompact`
   - `UserPromptSubmit` (可阻断)
   - `PermissionRequest`
3. 配置文件：`~/.hermes/hooks.toml`
4. 匹配器：支持按工具名/事件类型过滤
5. 阻断/重试：exit code 2 = 强制 retry

**验收标准**：
- [ ] 10 事件类型全部注册
- [ ] 配置文件可加载
- [ ] PostToolUse 退出码 2 触发 retry
- [ ] UserPromptSubmit 退出码 2 阻断 prompt
- [ ] 单元测试 + E2E 测试

**参考依据**：[Codex Hooks Reference](https://github.com/CodeAlive-AI/ai-driven-development/blob/main/skills/hooks-management/references/codex-hooks.md)

---

### P0-4：SubAgent Memory Inheritance + 独立 Context

**当前状态**：
- `SubAgentWorkspacePanel.tsx` 仅展示元数据
- subagent 无独立 context storage

**实现方案**：
1. `backend/app/services/subagent_memory.py`：
   - `SubAgentContext` dataclass：name, parent_context, skill_set, isolated_messages, output_dir
   - `SubAgentMemoryStore`：每个 subagent 独立 session_id 映射
2. `backend/app/api/agents.py`：扩展 endpoints
   - `POST /api/agents/{id}/memory/append`
   - `GET /api/agents/{id}/memory`
   - `POST /api/agents/{id}/memory/clear`
3. `frontend/src/components/SubAgentMemoryViewer.tsx`：memory 可视化

**验收标准**：
- [ ] subagent context 独立存储
- [ ] Memory inheritance 父→子传递
- [ ] Output routing 隔离
- [ ] 单元测试 + E2E 测试

**参考依据**：[TRAE Sub Agent 三大组件](https://littletool.com/trae-solo-china-edition-a-practical-guide-from-ai-coding-to-ai-army-operations/)

---

### P0-5：ChatView 组件独立提取（App.tsx 拆分第六阶段）

**当前状态**：
- App.tsx 1931 行
- `MessageRow` / `messages.map(...)` 仍在 AppLayout.tsx

**实现方案**：
1. 抽取 `frontend/src/components/ChatView.tsx`：
   - 接收 messages / streamingStatus / thinkingContent 等
   - 内部管理 MessageRow 渲染
2. 抽取 `MessageRow` 到独立 `frontend/src/components/chat/MessageRow.tsx`
3. AppLayout 直接使用 ChatView

**验收标准**：
- [ ] ChatView 可独立使用
- [ ] App.tsx / AppLayout.tsx 体积下降 ≥200 行
- [ ] TypeScript 编译 0 错误
- [ ] 单元测试 + E2E 测试

---

## 三、Cycle 4 P1 任务（次要交付）

### P1-1：会话 Archive / Fork
- 实现 `archive_session` / `unarchive_session` / `fork_session` 端点
- 归档列表 UI

### P1-2：TRACE Correction→Enforcement
- 用户纠正捕获（"下次不要 X"）
- 自动注入 AGENTS.md
- PostToolUse 拦截

### P1-3：OAuth 2.1 for MCP
- 标准 OAuth 2.1 Authorization Code + PKCE
- Bearer Token 自动刷新
- `/mcp/oauth/callback` 端点

### P1-4：Per-Task Worktree
- SubAgent 独立 git worktree
- 自动 merge 到主分支（通过 webhook）

### P1-5：Codex-style Memory Versioning
- Memory summaries versioned
- stale format 自动 rebuild
- 20K tokens 保留机制

---

## 四、Cycle 4 任务排期

| Phase | 任务 | 优先级 | 预计工期 |
|---|---|---|---|
| 1 | 互联网调研 | - | ✅ 已完成 |
| 2 | 功能差距分析 | - | ✅ 已完成 |
| 3 | P0-1 MCP SSE Transport 真实实现 | P0 | 0.5 天 |
| 4 | P0-5 ChatView 组件独立提取 | P0 | 0.5 天 |
| 5 | P0-2 Plan Mode UI + Rollback 链路 | P0 | 1 天 |
| 6 | P0-3 Hook 事件完整化（10 事件） | P0 | 1 天 |
| 7 | P0-4 SubAgent Memory Inheritance | P0 | 1 天 |
| 8 | 测试验证（单元 + E2E + 浏览器） | - | 0.5 天 |
| 9 | UI/UX 优化 + Loop Engineering 端到端验证 | - | 0.5 天 |
| 10 | Cycle 5 准备（生成报告 + 提交 git） | - | 0.5 天 |

**总工期**：约 5.5 天

---

## 五、与项目既有规范的对齐

### 项目硬约束
- ✅ 严格遵循 ROS2 / 通用 Python FastAPI 规范
- ✅ 模块化与可扩展性
- ✅ Git 版本控制 + 语义化版本（v5.0.0 → 计划）
- ✅ 单元测试 + E2E 测试覆盖
- ✅ 严禁动态内存分配 / 阻塞调用（高安全风险代码）

### 复用声明
- `StreamableHTTPMCPServer` 的 `_send_http` 基础结构（urllib → httpx）
- `ExternalMCPManager` 单例 + 配置持久化
- 现有 `SubAgentWorkspacePanel` UI 基础
- `ArchitectureDesignModal` 集成入口

---

**分析人**：Hermes 智能体调度平台
**下一步**：进入 Phase 3 - 开始 P0-1 MCP SSE Transport 真实实现
