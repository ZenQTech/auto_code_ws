# CYCLE 4 RESEARCH REPORT — Codex v0.150+ 与 TRAE SOLO v3.6+ 最新功能调研

> 调研时间：2026-07-27
> 调研目标：对比 Codex v0.145–v0.150+ 与 TRAE SOLO v3.5.79 / SOLO v3.6+ 最新特性，识别本平台尚未覆盖的关键能力。
> 调研方法：通过 .edu / .gov / 权威技术博客 (Codex changelog, TRAE docs, Daniel Vaughan tech blog, CodeAlive) 互联网搜索 + GitHub PR 文档交叉验证。
> 输出：Cycle 4 阶段2「功能差距分析」的事实依据。

---

## 一、Codex CLI 最新特性（v0.129–v0.150+）

### 1.1 智能审批系统（Smart Approvals，自 v0.120 起，v0.128 强化）

**来源**：[Codex CLI Smart Approvals: How Adaptive Command Policies and Prefix Rules Eliminate Approval Fatigue](https://codex.danielvaughan.com/2026/05/04/codex-cli-smart-approvals-adaptive-command-policies-prefix-rules/)

**核心创新**：
- 两轴安全模型：**Sandbox**（agent 能做什么）+ **Approval Policy**（什么时候必须询问）
- 默认搭配：`workspace-write` sandbox + `on-request` approval
- 三层审批栈协同：
  1. 基础 `approval_policy` (`untrusted` / `on-request` / `never`)
  2. **Starlark-based execution policy rules**（按命令前缀匹配）
  3. **Guardian Auto-Reviewer**（自动化审批代理）

**新批准模式（v0.144）**：`writes` app-approval mode
- 关键配置键：`apps._default.default_tools_approval_mode = "writes"`
- 通过 MCP `readOnlyHint: true` 标注的 read-only 工具自动放行，写操作触发 prompt
- 需要 `--strict-config` 标志才能识别该键
- 来源：[Codex CLI「writes」承認モードを試したら](https://qiita.com/kai_kou/items/e8a6abc7c7d5bd6ff6d6)

**本平台当前实现**：
- 已实现：MCP 工具的 `auto` / `manual` / `blocked` 三种模式（Cycle 3 P0-1）
- **缺失**：基于 Starlark 的 execution policy 规则、Guardian 自动审批代理、smart approval 学习

---

### 1.2 内置 MCP 一等公民化（v0.129 alpha.15，PR #21356）

**来源**：[Codex CLI's Built-in MCPs Just Became First-Class Runtime Servers](https://codex.danielvaughan.com/2026/05/07/codex-cli-builtin-mcp-first-class-runtime-servers-memory-isolation/)

**核心创新**：
- `BuiltinMcpServer` 与 `EffectiveMcpServer` 两层架构
- 内置 MCP（如 `memories`）使用**进程内 async transport**，不再产生 stdio 子进程
- `codex mcp list/get/login/logout` 等 CLI 命令仅作用于 configured servers
- 内存污染问题修复：内置 memories 不再触发 "memory mode polluted" 标记
- 为后续 skills marketplace 铺垫

**本平台当前实现**：
- 已实现：MCP 客户端 + 工具面板（Cycle 1/2/3）
- **缺失**：内置 MCP（如 memories）的 in-process transport、configured vs builtin 的语义分离

---

### 1.3 Lifecycle Hooks（v0.117–v0.124，2026-02–04）

**来源**：[Codex CLI / Codex App Hooks Reference](https://github.com/CodeAlive-AI/ai-driven-development/blob/main/skills/hooks-management/references/codex-hooks.md)

**支持的 10 个事件**：
| Event | Scope | When it fires |
|---|---|---|
| `SessionStart` | session | Session 初始化或恢复 |
| `SubagentStart` | subagent | Subagent 启动 |
| `PreToolUse` | turn | 工具运行前（可阻断）|
| `PermissionRequest` | turn | Codex 即将请求审批 |
| `PostToolUse` | turn | 工具完成后 |
| `PreCompact` | turn | 压缩前 |
| `PostCompact` | turn | 压缩后 |
| `UserPromptSubmit` | turn | 用户提交 prompt（可阻断）|
| `SubagentStop` | subagent | Subagent 即将停止 |

**配置方式**：
- 内联 `[hooks.*]` tables 在 `config.toml` 和 `requirements.toml`
- 传统 `hooks.json` 仍支持
- 规范特性键：`[features].hooks`（`codex_hooks` 已弃用）
- 非托管命令 hooks 需通过 `/hooks` 显式 review/trust

**PostToolUse 退出码 2 → 阻断结果并强制 retry**（TRACE enforcement 模式）

**本平台当前实现**：
- 已实现：Task 完成 hook（向智能体调度平台发送完成信号，触发 git commit）
- **缺失**：完整 10 事件覆盖、PostToolUse 退出码 2 强制 retry、PermissionRequest 拦截、SubagentStart/Stop 事件

---

### 1.4 会话生命周期（v0.136–v0.137）

**来源**：[Codex CLI Session Lifecycle: Archive, Resume, Fork, and Compact](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-lifecycle-archive-resume-fork-compact-management/)

**五个阶段**：`create → work → compact → archive → restore`

**存储**：JSONL rollout 文件 `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`

**核心命令**：
- `/new`：开启新 session
- `/compact`：触发压缩
- `codex resume` / `codex fork` / `codex archive` / `codex unarchive`
- `codex exec`：非交互执行
- `codex mcp list/get/login/logout`

**本平台当前实现**：
- 已实现：双触发 Compaction（pre-turn + mid-turn）、local/remote 压缩路径
- **缺失**：`archive/unarchive` 显式存档机制、JSONL rollout 标准化存储、fork session UI

---

### 1.5 Context Compaction（v0.131+）

**来源**：[深度解析 Codex Context Compaction](https://github.com/Quriosity-agent/articles/blob/main/2026-03-04/codex-context-compaction-deep-dive.md) + [Codex changelog v0.132.0](https://developers.openai.com/codex/changelog?ref=explainx)

**Codex 模型路径**（服务端加密）：
1. `responses.compact()`：LLM 生成明文摘要 → Fernet 加密 → 密文 blob
2. `responses.create()`：Handoff Prompt + 解密摘要 + 新请求

**非 Codex 模型路径**（本地压缩）：
- 直接 LLM 摘要，无加密
- 自定义 `/compact` 指令支持

**v0.132.0 新增**：Memory summaries **versioned**，stored format stale 时自动 rebuild
- PR #23148

**双触发机制**（Cycle 3 已实现，但 Codex 端参考价值高）：
- pre-turn（用户消息前）
- mid-turn（工具链循环边界）

**Codex 保留机制**：最近 20K tokens 不压缩 + 指数退避重试

**本平台当前实现**：
- 已实现：双触发 Compaction（pre-turn + mid-turn）、local/remote 路径、Fernet 加密等价（PGP 风格 Handoff）
- **缺失**：versioned memory summaries 自动 rebuild、20K tokens 保留机制、压缩失败指数退避

---

### 1.6 TRACE & Correction-to-Enforcement Pipeline（v0.124+，2026-07）

**来源**：[TRACE and the Correction-to-Enforcement Pipeline](https://codex.danielvaughan.com/2026/07/02/trace-compiling-user-corrections-runtime-enforcement-coding-agents-codex-cli-hooks-agents-md/)

**核心问题**（Zhou et al. June 2026 paper）：
- 即使成功 retrieve 偏好，agent 仍 57.5% 违反
- 解决方案 TRACE 将违反率从 100% 降至 2.0%

**实现机制**：
1. 监听 PostToolUse（exit 2 = 强制 retry + 反馈）
2. Session 结束脚本 → 编译用户纠正 → 注入 AGENTS.md
3. PreToolUse 拦截 → 检查是否匹配已编译规则

**本平台当前实现**：
- 已实现：AGENTS.md 多层加载、4 级优先级合并
- **缺失**：TRACE 风格的 correction compilation pipeline、PostToolUse 退出码 2 retry 强制

---

### 1.7 Realtime WebSocket & External Agent Migration（v0.145+）

**来源**：[Codex CLI 0.145.0-alpha.14](https://techdevnotes.com/releases/codex-cli/0.145.0-alpha.14)

**新特性**：
- 外部 agent 配置迁移（detect/import）
- **Frameless bidirectional realtime WebSocket**
- **JSONL event-processor output path** for `codex exec`（line-oriented machine-readable）
- **Remote MCP server configuration support** ← P0-1 候选
- `o1` 模型标识
- WebRTC transport option for thread realtime start
- Approval, tool-summary, web-search action variants 优化

**本平台当前实现**：
- 已实现：SSE 流式事件、JSONL 日志
- **缺失**：Remote MCP server configuration、Frameless WebSocket、JSONL event-processor output path

---

### 1.8 JetBrains ACP 集成（2026-07-25）

**来源**：[Codex as JetBrains Agent Provider](https://codex.danielvaughan.com/2026/07/25/codex-cli-jetbrains-agent-provider-acp-protocol-hooks-mcp-configuration/)

**核心**：通过 ACP (Agent Client Protocol) 将 Codex CLI 集成到 JetBrains IDE，成为多 agent 控制平面。

**本平台相关性**：中等。可作为未来 IDE 端集成的参考，但当前项目不直接面向 IDE 集成。

---

### 1.9 Auto-Generated AGENTS.md /init 优化（v0.148+）

**来源**：[Do Auto-Generated AGENTS.md Files Actually Help](https://codex.danielvaughan.com/2026/07/26/do-auto-generated-agents-md-files-actually-help-codex-cli-init-research-evidence-context-engineering/)

**关键发现**：
- `/init` 生成的 AGENTS.md 经常产生 context bloat
- 需要有筛选与裁剪机制
- 真正的成本是"仓库指南的真正成本"

**本平台当前实现**：
- 已实现：多类型规则扫描、合并大小限制、truncated 标记
- **缺失**：`/init` 风格的智能 AGENTS.md 生成（基于仓库结构自动归纳）

---

## 二、TRAE SOLO 最新特性（v3.5.55–v3.6+）

### 2.1 Plan Mode（中国版五大新特性之首）

**来源**：[Trae SOLO China Edition 五大新特性](https://test-news.aibase.com/news/23153) + [CSDN TRAE CN Solo 模式入门指南](https://blog.csdn.net/2301_80336940/article/details/155319409)

**核心机制**：
- 用户输入需求 → AI 自动拆解为执行计划（含文件修改列表、风险点、替代方案）
- 用户可增删、调整顺序
- **只有确认后才开始写代码**（避免"一键生成、一键崩溃"）

**本平台当前实现**：
- 已实现：P0-4 Plan Mode 后端（plan_extraction、LLM 交互、持久化、API endpoints）
- **缺失**：前端 Plan 列表的增删/调整 UI、风险点显示、文件修改预览、确认/拒绝完整流程

---

### 2.2 多任务并行（Multi-task Parallelism）

**来源**：[TRAE CN Solo 模式入门指南 §3.3](https://blog.csdn.net/2301_80336940/article/details/155319409)

**核心机制**：
- 每个 Tab 独立开发沙箱
- 隔离上下文管理：Context isolation storage + Resource allocation + State persistence
- 支持多端同步（移动端 / 网页端 / 桌面端）
- 任务列表统一管理，状态、路径、时间信息可视化

**本平台当前实现**：
- 已实现：SubAgent workspace 前端展示（P2-1）、多任务分屏
- **缺失**：完整的任务隔离上下文存储（context isolation storage）、资源调度、状态持久化

---

### 2.3 Sub Agent 机制

**来源**：[Trae SOLO China Edition Sub Agent 详解](https://littletool.com/trae-solo-china-edition-a-practical-guide-from-ai-coding-to-ai-army-operations/)

**核心机制**：
- 主 Agent - 子 Agent 架构
- 子 Agent 三大组件：
  1. **Skill template systems**（技能模板系统）
  2. **Memory inheritance mechanisms**（记忆继承机制）
  3. **Output routing management**（输出路由管理）
- 自动调度：主 Agent 根据任务类型自动创建并调度子 Agent
- 手动创建：用户定义子 Agent 功能描述，系统生成专属子 Agent
- 上下文隔离：各子 Agent 独立上下文环境，避免任务干扰

**本平台当前实现**：
- 已实现：SubAgent workspace 前端展示
- **缺失**：Memory inheritance 机制、Output routing、Skill template 系统、独立的子 Agent 上下文存储

---

### 2.4 DiffView

**来源**：[TRAE SOLO 模式概览 - DiffView](https://docs.trae.ai/ide/solo-mode)

**核心机制**：
- "查看变更"按钮 → 代码变更窗口
- 显示：文件数、变更行数、文件列表
- 点击文件查看 diff 视图
- **历史回溯**：支持查看至多 15 个会话的代码变更记录

**本平台当前实现**：
- 已实现：Git diff 集成（CodeViewer 组件）
- **缺失**：15 个会话的历史回溯、变更统计摘要

---

### 2.5 上下文管理（Context Compression）

**来源**：[TRAE CN Solo 模式入门指南 §3.5](https://blog.csdn.net/2301_803319409/article/details/155319409)

**核心机制**：
- **自动压缩**：智能识别冗余信息（已解决 Bug 讨论）并自动压缩
- **手动压缩**：发现 AI 偏离时手动触发
- **分层摘要算法**：提取关键信息 + 语义压缩

**本平台当前实现**：
- 已实现：双触发 Compaction（pre-turn + mid-turn）、local/remote 路径
- **缺失**：分层摘要算法、已解决 Bug 识别启发式

---

### 2.6 SOLO 移动端 + 多端协同（2026-05-07 重大更新）

**来源**：[TRAE SOLO 三端全量免费开放](https://forum.trae.cn/t/topic/15182)

**核心特性**：
- **语音优先的任务下发**：语音/文本/文件输入 + Context 选择
- **跨设备任务调度**：Cloud + 多 PC 远程执行
- **多端实时同步**：移动/网页/桌面端任务不中断
- **语音交互讨论**：实时语音对话 + 流式转录 + 自动生成会议纪要
- **飞书 CLI 接入**：粘贴飞书文档链接自动处理
- **定时任务**：桌面端、网页端支持
- **Worktree 功能**：每个任务独立 Git 环境

**本平台相关性**：
- 移动端：暂不在本平台范围
- 语音输入：可作为未来扩展
- 飞书 CLI 接入：可作为外部集成参考
- **Worktree 功能**：值得在 Cycle 4 实现，subagent 独立 Git 环境

---

### 2.7 全球记忆（Global Memory，2026-06-24 TRAE Work）

**来源**：[What's NEW in TRAE 2026-06-24 v0.1.21-0.1.23](https://www.trae.ai/changelog)

**核心特性**：
- TRAE Work v0.1.21-0.1.23 引入
- 跨所有过去交互保留上下文
- 整合为个性化知识库

**本平台当前实现**：
- 已实现：AGENTS.md 多层加载（user / project / sub-directory / override）
- **缺失**：跨 session 知识库整合、长期记忆持久化

---

### 2.8 Hooks 支持（TRAE IDE v3.5.66，2026-06-12）

**来源**：[What's NEW in TRAE 2026-06-12 v3.5.66](https://www.trae.ai/changelog)

**核心特性**：
- Settings → Hooks 配置
- 与 Codex hooks 概念类似
- 默认逐步弃用 Agent Delete Tool 自动执行（删除文件进回收站）

**本平台当前实现**：
- 已实现：Task 完成 hook → git commit
- **缺失**：完整 hook 事件覆盖（PreToolUse、PostToolUse、SessionStart 等）

---

### 2.9 工具面板的「Flow 模式 / 实时跟随」

**来源**：[TRAE 工具面板](https://docs.trae.ai/ide/tool-panels)

**核心机制**：
- 「实时跟随」按钮切换
- 开启后系统根据 AI 工作阶段自动切换工具（文档→编辑器→浏览器等）
- 实时展示工作进度和产物
- AI 处理时工具只读，手动干预需先关闭实时跟随

**本平台当前实现**：
- 已实现：StreamingStatusIndicator、阶段推理显示（P1-4）
- **缺失**：工具自动切换（仅在编程模式有效），Flow 模式状态指示

---

## 三、关键差距综合

| 维度 | Codex v0.150+ 能力 | TRAE SOLO v3.6+ 能力 | 本平台现状 | 差距等级 |
|---|---|---|---|---|
| **智能审批** | Starlark rules + Guardian auto-reviewer | 工具调用确认 | MCP auto/manual/blocked | 🟡 中（缺 Starlark 等价） |
| **Hook 事件** | 10 个事件 | 基础 Hooks 配置 | 仅 Task 完成 hook | 🟠 高（缺完整覆盖） |
| **Plan Mode** | - | 完整 Plan→Execute | 后端 MVP | 🟠 高（缺前端 Plan 增删/调整 UI） |
| **Sub Agent** | 完整 subagent + SubagentStart/Stop hook | 三大组件（Skill/Memory/Output） | 前端展示 + Subagent workspace | 🟠 高（缺 Memory inheritance） |
| **会话生命周期** | create→work→compact→archive→restore | 15 个会话历史回溯 | 双触发 compaction | 🟡 中（缺 archive/fork UI） |
| **Context Compaction** | Fernet 加密 + 20K 保留 + 指数退避 | 分层摘要算法 | 双触发 + local/remote 路径 | 🟡 中（缺版本化、保留机制） |
| **TRACE Pipeline** | Correction→Enforcement | - | 多层规则合并 | 🟠 高（缺 correction compilation） |
| **Global Memory** | 跨 session 知识库 | 跨所有过去交互 | 4 级 AGENTS.md | 🟡 中（缺长期记忆持久化） |
| **Remote MCP** | Remote MCP server config | - | 仅 stdio MCP | 🔴 极高（P0-1 候选） |
| **Worktree** | - | 每个任务独立 Git | 单一 git 仓库 | 🟡 中 |
| **JSONL Event Stream** | codex exec JSONL output | - | SSE 流式 | 🟡 中 |
| **Realtime WebSocket** | Frameless bidirectional | - | HTTP SSE | 🟢 低（暂可忽略） |

---

## 四、Cycle 4 P0 任务候选

基于调研，Cycle 4 重点推进：

### P0-1：Remote MCP Server Support（SSE Transport）
- 来源：Codex v0.145+ Remote MCP 配置
- 当前缺：External MCPServerConfig 缺 SSE transport 类型
- 价值：支持远程 MCP 生态扩展

### P0-2：ChatView 组件独立提取（App.tsx 拆分第六阶段）
- 来源：App.tsx 持续拆分（v4.3.0+ 第五阶段已完成 useModals）
- 当前缺：消息渲染 ChatView 仍在 App.tsx 内
- 价值：进一步降低 App.tsx 体积，提升可维护性

### P0-3：Plan Mode 深化 (Plan→Execute→Rollback 完整链路)
- 来源：TRAE Plan Mode 完整功能
- 当前缺：Plan 增删/调整 UI、Rollback 机制
- 价值：闭环 Plan 模式

### P0-4：Hook 事件完整化（10 事件对齐 Codex）
- 来源：Codex v0.124+ 10 lifecycle events
- 当前缺：仅 Task 完成 hook
- 价值：实现精细化控制

### P0-5：TRACE Pipeline - Correction→Enforcement
- 来源：Codex TRACE 模式
- 当前缺：correction compilation 机制
- 价值：解决 access-compliance gap

### P0-6：SubAgent Memory Inheritance
- 来源：TRAE Sub Agent Memory inheritance
- 当前缺：subagent 独立 context
- 价值：实现 subagent 真正独立

---

## 五、参考资料

### Codex
- [OpenAI Codex Changelog](https://developers.openai.com/codex/changelog?ref=explainx)
- [Codex CLI Smart Approvals](https://codex.danielvaughan.com/2026/05/04/codex-cli-smart-approvals-adaptive-command-policies-prefix-rules/)
- [Codex CLI Built-in MCPs First-Class](https://codex.danielvaughan.com/2026/05/07/codex-cli-builtin-mcp-first-class-runtime-servers-memory-isolation/)
- [Codex CLI Session Lifecycle](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-lifecycle-archive-resume-fork-compact-management/)
- [Codex CLI Writes Approval Mode](https://qiita.com/kai_kou/items/e8a6abc7c7d5bd6ff6d6)
- [Codex Hooks Reference](https://github.com/CodeAlive-AI/ai-driven-development/blob/main/skills/hooks-management/references/codex-hooks.md)
- [TRACE Pipeline](https://codex.danielvaughan.com/2026/07/02/trace-compiling-user-corrections-runtime-enforcement-coding-agents-codex-cli-hooks-agents-md/)
- [Codex CLI 0.145.0-alpha.14](https://techdevnotes.com/releases/codex-cli/0.145.0-alpha.14)
- [深度解析 Codex Context Compaction](https://github.com/Quriosity-agent/articles/blob/main/2026-03-04/codex-context-compaction-deep-dive.md)
- [Codex Interview Questions 2026](https://www.interviewcoder.co/blog/openai-codex-interview-questions)

### TRAE
- [TRAE SOLO 模式概览](https://docs.trae.ai/ide/solo-mode)
- [TRAE 工具面板](https://docs.trae.ai/ide/tool-panels)
- [TRAE What's NEW](https://www.trae.ai/changelog)
- [TRAE SOLO 三端全量免费开放](https://forum.trae.cn/t/topic/15182)
- [Trae SOLO China Edition 五大新特性](https://test-news.aibase.com/news/23153)
- [TRAE CN Solo 模式入门指南](https://blog.csdn.net/2301_80336940/article/details/155319409)
- [TRAE SOLO Sub Agent 详解](https://littletool.com/trae-solo-china-edition-a-practical-guide-from-ai-coding-to-ai-army-operations/)
- [Awesome Vibecoding Guide - TRAE](https://github.com/nabilshahzain/Awesome-Vibecoding-Guide/blob/main/docs/development-tools/recommended-tools/trae.md)
- [TRAE SOLO - AI Automated Development Assistant](https://aisharenet.com/en/trae-solo/)

---

**调研完成时间**：2026-07-27
**调研人**：Hermes 智能体调度平台
**下一步**：进入 Phase 2 - 功能差距分析，生成 GAP_ANALYSIS_CYCLE4.md
