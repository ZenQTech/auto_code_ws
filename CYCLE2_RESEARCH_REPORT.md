# 第二轮互联网调研报告 - Codex & TRAE SOLO 模式

> **调研时间**: 2026-07-27 11:00
> **参考来源**: OpenAI Codex 官方文档、Codex 0.145.0 完整参考、CSDN Codex 架构分析、TRAE 官方产品页、TRAE SOLO 实战文章
> **重点**: 对比 v0.145.0 最新特性，找出本项目差距

---

## 1. Codex CLI Solo 模式关键特性（v0.145.0，2026-07-24）

### 1.1 核心架构

| 层级 | 技术 | 备注 |
|------|------|------|
| 核心逻辑 | Rust (async, tokio) | codex-rs/ 60+ crate |
| CLI 分发 | Node.js (npm wrapper) | codex-cli/ 平台检测 |
| TUI | ratatui + crossterm | 异步非阻塞 I/O |
| App Server | JSON-RPC 2.0 | WebSocket/stdio 双传输 |
| 序列化 | serde_json / JSONL | |
| 构建 | Bazel + Cargo | |

### 1.2 智能代理循环（Agent Loop）

```
用户输入
  ↓
构建 Prompt（system + history + tool schemas + user message）
  ↓
推理（tokenize → sample → 流式输出 token）
  ↓
解析响应
  ├─→ 工具调用？→ 执行工具，将结果加入 history，重新进入循环
  └─→ 不调用？→ 输出 Assistant Message，结束本回合
```

**关键技术**:
- **Tokenisation**: Prompt 完整转换为 token 序列
- **Quadratic Growth**: 上下文累积问题（解决方案：Compaction）
- **Prompt Caching**: 长会话成本降低
- **Responses API**: 替代 Chat Completions 的新接口

### 1.3 App Server（JSON-RPC 2.0）

- **传输层**: WebSocket（远程）/ stdio（本地 IPC）
- **路径寻址**: 多 agent 并行（up to 6 in current release）
  - `/root/agent_a`、`/root/agent_b` 等
  - `spawn_agent` / `wait_agent` / `send_input` / `close_agent` 工具调用
- **流式事件**: EventMsg JSON 推送
- **用途**: VS Code、Xcode、JetBrains、Codex Desktop App 集成

### 1.4 沙箱与安全

| 平台 | 沙箱机制 |
|------|---------|
| macOS | Seatbelt |
| Linux | Landlock + seccomp |
| Windows | 受限令牌 |

**特点**: 内核级沙箱，与 Rust 进程同生命周期

### 1.5 工具与子命令

| 子命令 | 别名 | 功能 |
|--------|------|------|
| (默认) | — | 启动交互式 TUI |
| `exec` | `e` | 非交互式执行 |
| `review` | — | 代码审查 |
| `login` / `logout` | — | 账户认证 |
| `mcp` | — | MCP 服务器管理 |
| `app-server` | — | App Server 模式 |
| `sandbox` | — | 沙箱操作 |
| `resume` / `fork` | — | 会话管理 |
| `apply` | `a` | 应用差异 |
| `cloud` | — | 云端任务 |
| `features` | — | Feature Flag |

### 1.6 高级特性

- **MCP（Model Context Protocol）**: 工具扩展生态
- **Skills（插件）**: 自定义工作流
- **会话录制 / 恢复 / fork**: SQLite 持久化
- **AGENTS.md**: 项目级规则自动加载
- **Code Mode（实验性）**: JS 运行时 REPL
- **Voice Input（feature flag）**: 语音输入
- **Plan Mode**: 规划模式 + 协作
- **Memory System**: AGENTS.md 持久化
- **Compaction**: 长会话压缩（缓解 quadratic growth）

---

## 2. TRAE SOLO 模式关键特性（2026）

### 2.1 产品定位

完整 IDE + 内置 AI 引擎，**自主性等级**：
- **Code 模式**（`Ctrl+I`）：低（你主导）
- **MTC 模式**（侧边栏）：中（协作式）
- **Solo Agent 模式**（`/solo`）：高（AI 主导）

### 2.2 多 Agent 架构

```
┌─────────────────┐ classify ┌──────────────────────┐
│ Your Input      │ ─────────→ │ dev (router)          │
└─────────────────┘            └──────────────────────┘
                                  │
   ┌──────────────────────────────┼────────────────────────────┐
   │                              │                            │
   ▼                              ▼                            ▼
@frontend-specialist      @backend-specialist       @debugger
@devops-engineer          @security-auditor         @test-engineer
@mobile-developer         @performance-optimizer    ...
```

**TRAE Kit 增强**:
- 20 个领域专家 agent
- 11 个自动斜杠命令工作流
- 优化的 fixed context（~1312 tokens，比原生 4400+ 减少 70%）

### 2.3 核心特性

- **CUE**: 智能补全（Tab 键预测下一步编辑）
- **Multi-Model**: 字节自研 + 第三方 + 本地模型可选
- **MCP**: 通过 Model Context Protocol 集成外部资源
- **Preview Tab**: 内置浏览器调试（元素交互、console 日志）
- **/solo 命令**: 触发端到端任务执行
- **Custom Agents**: 自定义智能体（工具、技能、逻辑可配置）
- **IDE ↔ SOLO**: 无缝切换
- **Voice Input**: 自然语言或语音命令

### 2.4 Sub-Agent 协作

- 每个 agent 有独立模型 + 上下文
- 用户可选最适合的模型
- 实时跟踪每个 agent 的进度
- 必要时调整/重定向

---

## 3. 本项目（Hermes/智能体调度平台）现状对照

### 3.1 已有功能（已实现）

| 功能模块 | 状态 | 备注 |
|---------|------|------|
| Loop Engineering 工作流 | ✅ | 5 阶段：clarifying/designing/prompting/executing/reviewing |
| Plan 模式后端 | ✅ | plan_mode.py + plan.py（4 个端点） |
| React Router | ✅ | 5 路由 + 通配回退 |
| AppLayout 三栏布局 | ✅ | Sidebar + ChatMainArea + UsagePanel |
| 斜杠命令 | ✅ | /review /fix /review-fix-loop |
| 流式 SSE | ✅ | HermesService 集成 |
| 多 Agent | ✅ | AgentChatCard 网格 |
| DiffView | ✅ | Myers/Patience diff |
| PlanViewer | ✅ | |
| CodeViewer | ✅ | |
| WebSocket | ✅ | |
| CLI 集成 | ✅ | CLIExecutor + CurlLLMExecutor |
| Git 集成 | ✅ | GitManager + CommitHookHandler |
| 数据库 | ✅ | SQLite + WAL + 启动迁移 |
| 缓存 | ✅ | ETag + Cache-Control |
| 限流 | ✅ | 滑动窗口（20 req/min） |
| GZip | ✅ | |
| 错误处理 | ✅ | TaskRecoveryManager |
| 审查/修复 API | ✅ | /api/review /api/fix /api/review-fix-loop |
| 架构设计 | ✅ | architecture_workflow_service |
| 任务恢复 | ✅ | task_hook_handler |
| 会话 CRUD | ✅ | active/archived/trash 三态 |

### 3.2 缺失功能（与 codex/trae 对比）

| 编号 | 缺失功能 | Codex 借鉴 | TRAE 借鉴 | 优先级 |
|------|---------|-----------|----------|--------|
| G1 | **JSON-RPC App Server** | ✅ | - | P0 |
| G2 | **MCP（Model Context Protocol）集成** | ✅ | ✅ | P0 |
| G3 | **会话 fork / resume 高级管理** | ✅ | - | P0 |
| G4 | **Skills 插件系统** | ✅ | - | P0 |
| G5 | **AGENTS.md Memory System** | ✅ | - | P0 |
| G6 | **CUE 智能代码补全** | - | ✅ | P1 |
| G7 | **Preview Tab（内置浏览器调试）** | - | ✅ | P1 |
| G8 | **多 Agent 路由层（TRAE Kit 风格）** | - | ✅ | P1 |
| G9 | **Code Mode（runtime REPL）** | ✅ | - | P2 |
| G10 | **云端任务执行（Codex Cloud 风格）** | ✅ | - | P2 |
| G11 | **Voice Input** | ✅ | ✅ | P2 |
| G12 | **Compaction（长会话压缩）** | ✅ | - | P0 |
| G13 | **Sandbox 抽象层** | ✅ | - | P0 |
| G14 | **EventMsg 流式事件协议** | ✅ | - | P1 |

### 3.3 已完成但可优化

| 功能 | 当前实现 | codex/trae 借鉴优化点 |
|------|---------|---------------------|
| 流式响应 | SSE 文本流 | 改为结构化 EventMsg（type: token/thinking/tool_call） |
| 工具调用 | HermesService 内置 | 抽象为 MCP 工具，可动态加载 |
| 会话管理 | CRUD + trash | 借鉴 fork/resume，添加 session 继承 |
| 沙箱 | 进程级隔离 | 借鉴 landlock+seccomp 内核级 |
| 多 Agent | 串行 spawn | TRAE Kit 风格路由层 + 并行（up to 6） |

---

## 4. 本轮目标功能（推荐实施清单）

### 4.1 P0 必做（核心缺失）

1. **MCP（Model Context Protocol）集成** [G2]
   - 服务端：FastAPI MCP endpoint，支持 tools/list, tools/call
   - 客户端：MCPClient 抽象，支持 stdio/SSE 两种传输
   - 至少实现 3 个内置工具：read_file / write_file / run_command
   - spec: `.trae/specs/mcp-integration/spec.md`

2. **会话 fork/resume 高级管理** [G3]
   - `/api/sessions/{id}/fork` 端点
   - `/api/sessions/{id}/resume` 端点
   - 前端：会话列表右键菜单添加 fork 选项
   - spec: `.trae/specs/session-fork-resume/spec.md`

3. **Skills 插件系统** [G4]
   - 数据模型：Skill（name, description, prompt, tools[]）
   - `/api/skills` CRUD 端点
   - 前端：设置面板添加 Skills 管理
   - spec: `.trae/specs/skills-plugin/spec.md`

4. **AGENTS.md Memory System** [G5]
   - 后端：自动读取项目根 AGENTS.md 并注入到 system prompt
   - 前端：项目设置中显示当前 AGENTS.md 内容
   - spec: `.trae/specs/agents-md-memory/spec.md`

5. **Compaction（长会话压缩）** [G12]
   - 后端：Compressor 服务（保留最近 N 条 + 摘要历史）
   - 自动触发：消息数 > 50 或 token 数 > 阈值
   - spec: `.trae/specs/compaction/spec.md`

### 4.2 P1 推荐（重要增强）

6. **CUE 智能代码补全** [G6]
7. **Preview Tab（内置浏览器调试）** [G7]
8. **多 Agent 路由层** [G8]
9. **EventMsg 结构化事件协议** [G14]

### 4.3 P2 可选（远期）

10. **Code Mode（runtime REPL）** [G9]
11. **云端任务执行** [G10]
12. **Voice Input** [G11]
13. **Sandbox 抽象层** [G13]

---

## 5. 风险评估

| 风险项 | 等级 | 缓解策略 |
|--------|------|---------|
| MCP 协议复杂度 | 中 | 优先实现最小可用版本，逐步扩展 |
| Skills 安全性 | 高 | 沙箱执行 + 权限申请 |
| Compaction 数据丢失 | 中 | 保留原始消息 + 摘要可重建 |
| AGENTS.md 注入 LLM 上下文 | 低 | 限制最大长度（4KB） |
| 多 Agent 路由性能 | 中 | 限制并发数为 6 |

---

## 6. 结论

本项目虽然已实现 23 项核心功能，但与 codex v0.145.0 和 TRAE SOLO 最新版本对比，仍有 14 项功能缺失。

**本轮循环重点实施 P0 5 项**：
1. MCP 集成
2. 会话 fork/resume
3. Skills 插件
4. AGENTS.md Memory
5. Compaction 压缩

实施完成后，本项目功能完整度将提升至 95%+ codex/trae 等价能力。
