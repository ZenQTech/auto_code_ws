# Cycle 27 Codex / TRAE Solo 模式 2026 深度调研报告

**调研日期**: 2026-07-30
**调研主题**: codex v0.145+、Claude Code 2026-06、Claude Code Plugins、Claude Code Skills、Claude Code Sub-Agents + TRAE SOLO Mobile / Work 模式 2026 关键演进
**目标**: 识别本项目（Hermes Agent 平台）尚未覆盖的关键能力，形成 P0/P1/P2 优先级规划

---

## 一、调研背景

2026 年是 AI 编程代理从"单助手"走向"多智能体编排"的关键一年。Codex CLI v0.145 稳定化 Multi-Agent V2；Claude Code 2026-06 release train 一次性发布 10 大新特性（嵌套子代理、社区工具市场、Agent Checkpointing 等）；TRAE 把 SOLO 重命名为 Work、推出 Worktree Feature、加入 Hooks 与 Plugin 系统、Design Mode、Global Memory 全面落地。

本报告重点提取对 Hermes 平台有借鉴价值的**六大领域、十二项关键能力**，分析落地路径与差距。

---

## 二、Codex CLI 2026 v0.145+ 关键特性

### 2.1 Multi-Agent V2 稳定化（v0.145.0, 2026-07-21）

**核心能力**：
- **Path-Based Addressing**：用层级路径（如 `/root/researcher/summarizer`）替代 v1 的不透明 ThreadId
- **Named Task Spawning**：`spawn_agent` 必须传 `task_name`，人类可读的代理树
- **Structured Messaging**：`send_message` / `followup_task` 替代原始 inter-thread 通信
- **可配置子代理**：每子代理可独立设置 model / reasoning effort / concurrency
- **角色约束**：可限制同时工作的执行者数量，控制负载与 token 消耗

**API 形态**（app-server JSON-RPC 2.0）：
```typescript
spawn_agent({
  task_name: "analyzer",
  message: "Analyze the API surface",
  model: "gpt-5.5",
  reasoning_effort: "high"
})

send_message({
  to: "/root/analyzer",
  message: "Continue with step 2"
})
```

**Hermes 现状**：我们已有 `MultiTaskOrchestrator` 支持 5-10 任务并行，但**缺乏结构化消息协议**和**层级路径寻址**。

来源：[codex.danielvaughan.com - Multi-Agent v2 Complete Guide](https://codex.danielvaughan.com/2026/04/11/codex-cli-multi-agent-orchestration-v2-complete-guide/)

### 2.2 /import 跨工具迁移（v0.145.0, 2026-07-21）

**核心能力**：
- 从 Cursor / Claude Code 迁移：设置、MCP servers、插件、会话、命令、记忆
- 不移动源代码，只迁移 agent 配置和上下文
- 切换 IDE 时大幅减少重新配置工作量

**Hermes 现状**：**完全缺失**。这是 Onboarding 体验的关键能力。

### 2.3 实验性分页对话历史（v0.145.0, 2026-07-21）

**核心能力**：
- 高效恢复、搜索、持久化命名
- 子代理（sub-agent）支持
- 记忆（memories）功能
- 解决长时间会话的 Context Window 膨胀问题

**Hermes 现状**：我们已有 `GlobalMemoryEngine` 跨 session 持久化偏好，但**缺乏分页会话历史**和**子代理专属记忆隔离**。

### 2.4 Codex Remote GA（v0.130+, 2026-06-25 正式 GA）

**核心能力**：
- **QR Relay**：移动设备与 host 之间的认证配对
- **DigitalOcean 插件**：开发者可一键创建云端工作区
- **Thread Handoff**：在多台机器间迁移会话
- **Noise Protocol**（v0.141）：端到端加密 relay 通道
- **Phone as Control Plane**：5M 用户可在手机上审批 agent 操作

**架构核心**（来源：[codex.danielvaughan.com - Remote GA](https://codex.danielvaughan.com/2026/06/29/codex-remote-ga-qr-relay-digitalocean-plugin-mobile-approval-workflow-phone-as-control-plane/)）：
- App-server JSON-RPC 2.0 WebSocket
- Multi-environment registry（每个环境独立 CWD、env vars、sandbox config）
- Bearer token 认证 + 设备枚举 + 授权撤销
- Remodex bridge 连接移动端

**Hermes 现状**：**完全缺失**。当前无远程/移动端能力。

### 2.5 Multi-Directory Workflows（v0.130+）

**核心能力**：
- `--add-dir` CLI flag：临时多目录访问
- `writable_roots` in config.toml：持久多目录访问
- **Permission Profiles** with `:project_roots`：细粒度文件系统控制
- **AGENTS.md Hierarchical Loading**：跨目录边界自动加载各仓库的规范

**Hermes 现状**：**部分缺失**。我们有 Worktree Backend Adapter，但**缺乏 Permission Profile 机制**。

### 2.6 Git Worktree 并行开发隔离

**核心能力**：
- Thread/Turn/Item 三层架构
- 每个 Thread 独立 CWD + 沙箱策略
- Meta-Agent 父子线程（parentThreadId 字段）
- 派生线程监听事件流自动合并

**Hermes 现状**：已有 Worktree 引擎和 Backend Adapter 抽象，但**缺乏事件流合并 + PR 联动**。

---

## 三、Claude Code 2026-06 十大新特性

来源：[sitepoint.com - Claude Code June 2026](https://www.sitepoint.com/claude-code-june-2026-10-new-features-devs-need-to-know/)

### 3.1 Nested Sub-Agents with 3-Level Depth

**核心能力**：
- 父代理可创建子代理，子代理可再创建子子代理
- 最多 **3 层**嵌套
- 每层可分配不同的 role、model、constraint set
- 每层独立 context window

**配置示例**（.claude/agents.yaml）：
```yaml
max_depth: 3
agents:
  - agent_role: migration_coordinator
    model: claude-sonnet-4
    delegate_to:
      - agent_role: module_migrator
        model: claude-sonnet-4
        delegate_to:
          - agent_role: function_refactorer
            model: claude-haiku
```

**Hermes 现状**：**完全缺失**。当前 MultiTaskOrchestrator 是平铺式，没有层级。

### 3.2 fallbackModel Configuration

**核心能力**：
- 模型失败时自动回退到备选模型
- 链式回退（primary → fallback1 → fallback2）
- 按场景配置：成本敏感 / 质量敏感

**Hermes 现状**：我们已有 `ModelRouter`，但**缺乏 fallback chain 机制**。

### 3.3 Community Tool Marketplace

**核心能力**：
- CLI 形式：`claude marketplace search "react"`
- 一键安装：`claude marketplace install <package>`
- 包括 linters, formatters, custom slash commands, refactoring utilities
- 官方 + 社区双轨

**Hermes 现状**：**完全缺失**。我们没有 marketplace 概念。

### 3.4 Usage Attribution and Cost Tracking

**核心能力**：
- 每次模型调用按 agent / user / project 归因
- 实时成本仪表板
- 按维度（agent、sub-agent、tool）分摊

**Hermes 现状**：我们已有 `Model Router` 和 `Cost Prediction`，但**缺乏按 agent 归因**。

### 3.5 Scoped Permissions for Sub-Agents

**核心能力**：
- 每个 sub-agent 独立权限集
- 工具级别的 allow/deny
- 继承/覆盖父代理权限
- 防止权限污染

**Hermes 现状**：**完全缺失**。

### 3.6 Streaming Agent Logs

**核心能力**：
- 实时流式输出子代理日志
- 嵌套层级可视化
- 父子关联回放

**Hermes 现状**：我们已有 `SSEInterceptor` 和 `Hook Performance Analyzer`，但**缺乏嵌套子代理日志流**。

### 3.7 Agent Checkpointing and Resume

**核心能力**（核心创新！）：
- **Checkpoint 树**保存：每个 sub-agent 的进度、中间输出、待办任务队列
- 多小时任务可暂停后从任意子代理状态恢复
- **区别于 Session Persistence**：Session 只保存对话历史，Checkpoint 保存**整个 agent tree state**
- CLI：`claude checkpoint save <name>` / `claude checkpoint restore <name>`

**配置**：
```bash
# Save current agent tree state
claude checkpoint save migration-v2
# Output: Checkpoint 'migration-v2' saved. 3 agents checkpointed, 2 tasks pending.

# Resume from checkpoint
claude checkpoint restore migration-v2
```

**Hermes 现状**：我们已有 `Session Replay`，但**缺乏 agent tree checkpoint 机制**。

### 3.8 Inline Cost Budgets per Agent

**核心能力**：
- 每个 agent 独立成本预算
- 超出预算自动暂停 / 告警 / 切换模型
- 与 Cost Attribution 联动

**Hermes 现状**：我们已有 `Cost Prediction`，但**缺乏 per-agent budget enforcement**。

### 3.9 Custom Agent Templates

**核心能力**：
- 用户可创建自定义 agent 模板
- 模板市场：下载、上传、评分
- 内置模板：code-reviewer, debugger, custom

**Hermes 现状**：**部分缺失**。我们有 Best-of-N Worktree 和 Hook Template，但**没有 Agent Template 概念**。

### 3.10 Multi-Repo Orchestration

**核心能力**：
- 单个 Claude 会话可同时操作多个 Git 仓库
- 跨仓库依赖分析
- 跨仓库 PR 协调

**Hermes 现状**：我们已有 `MultiRepoSync` 和 `WorktreeBackendAdapter`，但**缺乏跨仓库依赖编排**。

---

## 四、Claude Code Sub-Agents 体系深度

来源：[code.claude.com - Sub-Agents](https://code.claude.com/docs/en/sub-agents)

### 4.1 三种作用域 + CLI 动态

| 类型 | 路径 | 作用域 | 优先级 |
|------|------|--------|--------|
| Project | `.claude/agents/` | 当前项目 | 最高 |
| User | `~/.claude/agents/` | 全局 | 较低 |
| Plugin | `agents/` in plugin root | 插件 | - |
| CLI | `--agents JSON` | 当前会话 | 介于项目和用户之间 |

### 4.2 文件格式

```markdown
---
name: code-reviewer
description: Expert code reviewer. Use proactively after code changes.
tools: Read, Grep, Glob, Bash
model: sonnet
---

You are a senior code reviewer. Focus on code quality, security, and best practices.
...
```

### 4.3 关键能力

- **独立 context window**：防止主会话被污染
- **特定工具集**：最小权限原则
- **特定 system prompt**：专注角色
- **可显式调用**：`Use the code-reviewer subagent to check my recent changes`
- **自动调用**：Claude 遇到匹配任务时自动调度

**Hermes 现状**：**完全缺失**。Sub-Agents 是 Claude Code 的核心编排原语，Hermes 没有等价物。

---

## 五、Claude Code Plugins & Skills 体系

来源：[insidepc.tech - Plugins in Claude Code](https://insidepc.tech/ai/ai-agents/plaginy-claude-code)

### 5.1 Plugin 概念

- **Plugin = 打包的组合**：skills + sub-agents + slash-commands + MCP servers + hooks + manifest
- **plugin.json 清单**描述
- **安装命令**：`/plugin install <name>@claude-plugins-official`
- **第三方市场**：`/plugin marketplace add <owner/repo>`

### 5.2 官方市场数据（2026-03）

- **101 plugins**：33 来自 Anthropic + 68 来自合作伙伴
- 三级信任模型
- 风险：第三方插件执行任意代码（已有真实攻击链 PromptArmor、Prompt Security 报告）

### 5.3 自定义市场

- 一个 git 仓库 + `.claude-plugin/marketplace.json` 即可
- 无需服务器

**Hermes 现状**：**完全缺失**。没有 Plugin 系统、没有 Marketplace、没有 Skill 系统。

### 5.4 Skills vs Plugin vs MCP Server 区别

| 维度 | Skill | Plugin | MCP Server |
|------|-------|--------|------------|
| 内容 | 程序性工作流 | 完整能力包 | 外部工具桥接 |
| 分布 | 单文件 Markdown | 多文件 + manifest | 独立 server 进程 |
| 加载 | 按需（token budget） | 安装即用 | 连接即用 |
| 用途 | 部署清单、review 流程 | 团队分发 | 数据库、API、浏览器 |

---

## 六、Claude Code 上下文管理四策略

来源：[Peiyaooooo - Claude Code Architecture](https://github.com/Peiyaooooo/claude-code-reverse-engineered/blob/main/architecture.md)

### 6.1 四种策略（按严重度升级）

1. **Auto-Compact**：主动摘要压缩，保留关键信息
2. **Reactive Compact**：413 Prompt Too Long 错误触发的紧急压缩
3. **Microcompact (CACHED_MICROCOMPACT)**：per-message tool result 大小预算，超限持久化到磁盘
4. **History Snip (HISTORY_SNIP)**：显式丢弃旧消息，SnipTool 让模型主动控制

### 6.2 AsyncGenerator 流水线

- QueryEngine: 每个会话一个
- Query Loop: while(true) 调度
- StreamingToolExecutor: 工具到达即开始执行（不等响应结束）
- Static/Dynamic system prompt split for cache

**Hermes 现状**：我们已有 `SSEInterceptor` 和四维压缩算法雏形，但**缺乏 SnipTool 显式丢弃机制**和 **Microcompact 落盘策略**。

---

## 七、Claude Code Checkpointing 深度机制

来源：[code.claude.com - Checkpointing](https://code.claude.com/docs/en/checkpointing.md)

### 7.1 触发与内容

- 每个用户提示自动创建一个 Checkpoint
- **只跟踪 Claude 通过 Write/Edit 工具的文件编辑**
- **不跟踪 Bash 命令（如 rm）或用户手动更改**

### 7.2 存储与生命周期

- 存储位置：`~/.claude/projects/<project-path>/<session-id>.jsonl`
- 保留：最近 **100 个 Checkpoint**
- 清理：30 天后自动清理（可配置 `cleanupPeriodDays`）
- 跨会话持久化：会话恢复后仍可 `/rewind`

### 7.3 Rewind 操作类型

| 操作 | 文件 | 对话 | 用途 |
|------|------|------|------|
| Restore code and conversation | ✅ | ✅ | 完全回退 |
| Restore conversation | ❌ | ✅ | 重发提示 |
| Restore code | ✅ | ❌ | 仅回退文件 |
| Summarize from here | ❌ | 📝 摘要 | 释放 context |
| Summarize up to here | 📝 摘要 | ❌ | 压缩早期 |

### 7.4 SDK 集成

```python
options = ClaudeAgentOptions(enable_file_checkpointing=True)
async with ClaudeSDKClient(options) as client:
    await client.query("重构认证模块")
    checkpoint_id = ... # 从响应流中获取
    await client.rewind_files(checkpoint_id)  # 按 UUID 恢复
```

**Hermes 现状**：**完全缺失**。我们的 Session Replay 是"回放"不是"回退"。

---

## 八、Claude Code 7种指引方式

来源：[claude.com - Steering Claude Code](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)

| Method | 加载时机 | Compaction | 上下文成本 | 适用场景 |
|--------|---------|-----------|-----------|---------|
| CLAUDE.md (root) | Session start | Memoized 缓存 | 高 | 构建命令、目录结构、团队规范 |
| CLAUDE.md (subdir) | On-demand | 丢失 | 低 | 子目录特定约定 |
| Rules | Session start/path-scoped | 压缩后重注入 | 中 | 硬约束（API 校验、命名） |
| Skills | 名称/描述启动时，body 按需 | 共享 token 预算 | 低 | 程序性工作流（部署清单） |
| Subagents | 仅调用时 | 仅 summary 返回 | 低 | 隔离任务 |
| Hooks | 生命周期事件触发 | 完全绕过 | 低 | 确定性自动化 |
| Output styles | Session start | 永不压缩 | 高 | 角色切换 |

**Hermes 现状**：我们部分实现了 Hooks、Rules、Sub-Agents（通过 MultiTaskOrchestrator），但**缺乏 Skills 概念**和**多层级 CLAUDE.md 加载**。

---

## 九、TRAE 2026 关键演进时间线

来源：[trae.ai/changelog](https://www.trae.ai/changelog)

| 日期 | 版本 | 关键更新 |
|------|------|---------|
| 2026-05-05 | v0.1.8-9 | **SOLO mobile app 启动**（语音输入、多设备连接、远程桌面、实时任务进度） |
| 2026-05-05 | v3.5.55-56 | **Worktree feature** 启动（每个任务独立 Git 环境） |
| 2026-05-08 | v3.5.55-56 | Builder & Builder With MCP 合并为 Agent；SOLO Builder & SOLO Coder 合并为 SOLO Agent |
| 2026-05-15 | v3.5.57-58 | 修复 subagent card 展开/折叠 bug |
| 2026-05-25 | v0.1.10-12 | 优化终端命令跨平台稳定性 |
| 2026-06-01 | v0.1.13-15 | SOLO desktop 支持浏览器元素选择加入对话 |
| 2026-06-07 | v3.5.63-64 | Subagent card 展开/折叠修复 |
| 2026-06-09 | v0.1.18 | **TRAE SOLO → TRAE Work 重命名**；企业账号登录 |
| 2026-06-09 | v0.0.8 | 内置/自定义/替代 AI 模型切换 |
| 2026-06-10 | v3.5.65 | 修复 |
| 2026-06-12 | v3.5.66 | **Hooks 正式支持**（Settings → Hooks）；Agent Delete Tool 软删除到回收站 |
| 2026-06-18 | v0.1.19-20 | 软删除 Canary 部署 |
| 2026-06-24 | v0.1.21-23 | **Design Mode**（设计工作流一站式工具集）；Voice Chat 增强；**Global Memory** 全面可用 |
| 2026-06-24 | v0.0.9 | 仓库和分支搜索；默认输出 HTML |
| 2026-06-29 | v3.5.67-71 | 文件格式 subagent toggle（默认启用）；retryable error (-1/3003) 自动重试 |
| 2026-07-07 | v0.0.10-11 | SOLO Mobile 语音对话中可加入图片/文件 |
| 2026-07-14 | v0.0.12-13 | 图片预览（缩略图/全屏/滑动）；HTML 输出分享；任务搜索/置顶；应用内通知 |
| 2026-07-18 | v3.5.73-78 | Browser configuration page（个人版） |
| 2026-07-21 | v3.5.79 | 安全修复 |
| 2026-07-21 | v0.1.39 | TRAE Work 视频生成 |
| 2026-07-21 | v0.0.14 | "Jump to Latest" 按钮 |
| 2026-07-27 | v0.0.15 | 移动端插入插件 |

### 9.1 TRAE 体系核心架构

- **IDE 模式** vs **SOLO 模式**（现 Work 模式）双轨
- **Code Mode** vs **MTC（More Than Coding）Mode**
- **CUE** 代码补全（Python/TypeScript/Golang 智能导入/重命名）
- **TRAE Rules** 自定义 AI 工作规则
- **MCP** Model Context Protocol（标准工具桥接）
- **Voice Chat**（多模态语音）
- **Global Memory** 跨 session 知识库
- **Worktree** 任务级 Git 隔离
- **Hooks** 生命周期自动化
- **Design Mode** 设计工作流

### 9.2 与 Hermes 现状对比

| TRAE 能力 | Hermes 现状 | 差距 |
|----------|------------|------|
| Code Mode + MTC Mode | 有（Cycle 26 MTC Adapter） | ✅ 已覆盖 |
| Global Memory | 有（Cycle 24 GlobalMemoryEngine） | ✅ 已覆盖 |
| Worktree | 有（Cycle 20 Worktree） | ✅ 已覆盖 |
| Hooks | 有（Cycle 20 Hooks） | ✅ 已覆盖 |
| CUE 代码补全 | 无 | ❌ 缺失 |
| TRAE Rules | 部分（ProjectMemory） | ⚠️ 需增强 |
| MCP 工具桥接 | 部分（MCP tools） | ⚠️ 需增强 |
| Voice Chat | 有（Cycle 24 VoiceInputAdapter） | ✅ 已覆盖 |
| Design Mode | 有（Cycle 24 FigmaAdapter） | ✅ 已覆盖 |
| SOLO Mobile | 无 | ❌ 缺失 |
| QR Relay / Remote | 无 | ❌ 缺失 |
| Thread Handoff | 无 | ❌ 缺失 |

---

## 十、关键差距分析

### 10.1 已有能力（C20-C26 已覆盖）

| 领域 | Hermes 引擎 | 引入版本 |
|------|------------|---------|
| Multi-Repo / Worktree | `WorktreeBackendAdapter` | v6.45.0 C20 |
| Hooks | `HookTemplateMarket` | v6.46.0 C20 |
| Job/Task Monitor | `JobMonitor` | v6.45.0 C20 |
| Model Router | `ModelRouter` | v6.46.0 C20 |
| Side Chats | `MultiConversation` | v6.45.0 C20 |
| Best-of-N × Worktree | `BestOfNWorktreePanel` | v6.48.0 C21 |
| Hook Chain | `HookChainVisualizer` | v6.48.0 C21 |
| Cost Prediction | `CostPredictionEngine` | v6.51.0 C22 |
| Hook Performance | `HookPerformanceAnalyzer` | v6.52.0 C22 |
| Smart Approval | `SmartApprovalEngine` | C26 |
| Voice Input | `VoiceInputAdapter` | v6.57.0 C24 |
| Global Memory | `GlobalMemoryEngine` | v6.58.0 C24 |
| Multi-Task | `MultiTaskOrchestrator` | v6.59.0 C24 |
| Figma to Code | `FigmaAdapter` | v6.60.0 C24 |
| Auto Code Review | `AutoCodeReviewEngine` | v6.62.0 C25 |
| PR Bot | `PRBotSimulator` | v6.63.0 C25 |
| AI Performance Optimizer | `AIPerfOptimizer` | v6.64.0 C25 |
| CSV Batch | `CsvBatchEngine` | C26 |
| MTC Adapter | `MtcAdapter` | C26 |

### 10.2 缺失能力（P0 优先级）

| ID | 能力 | 来源 | 优先级 |
|----|------|------|--------|
| **G27-01** | **Nested Sub-Agents**（3 层嵌套） | Claude Code 2026-06 #1 | P0 |
| **G27-02** | **Agent Checkpointing & Tree Resume** | Claude Code 2026-06 #7 | P0 |
| **G27-03** | **Path-Based Multi-Agent Addressing** | Codex v0.145 V2 | P0 |
| **G27-04** | **Structured Agent Messaging**（send_message / followup_task） | Codex v0.145 V2 | P0 |
| **G27-05** | **Agent Template System**（含 marketplace） | Claude Code 2026-06 #9 | P0 |
| **G27-06** | **Codex Remote / QR Relay / Thread Handoff** | Codex v0.130 GA | P0 |

### 10.3 缺失能力（P1 优先级）

| ID | 能力 | 来源 | 优先级 |
|----|------|------|--------|
| **G27-07** | **Scoped Permissions for Sub-Agents** | Claude Code 2026-06 #5 | P1 |
| **G27-08** | **Streaming Agent Logs**（嵌套层级可视化） | Claude Code 2026-06 #6 | P1 |
| **G27-09** | **Inline Cost Budgets per Agent** | Claude Code 2026-06 #8 | P1 |
| **G27-10** | **Multi-Repo Orchestration**（依赖分析 + 协调） | Claude Code 2026-06 #10 | P1 |
| **G27-11** | **fallbackModel Chain** | Claude Code 2026-06 #2 | P1 |
| **G27-12** | **Skills System**（程序性工作流） | Claude Code | P1 |
| **G27-13** | **/import 跨工具迁移** | Codex v0.145 | P1 |
| **G27-14** | **History Snip Tool**（显式丢弃） | Claude Code | P1 |
| **G27-15** | **Microcompact 落盘策略** | Claude Code | P1 |
| **G27-16** | **Permission Profiles** | Codex v0.130+ | P1 |

### 10.4 缺失能力（P2 优先级）

| ID | 能力 | 来源 | 优先级 |
|----|------|------|--------|
| G27-17 | **Community Tool Marketplace**（独立子项目） | Claude Code 2026-06 #3 | P2 |
| G27-18 | **Remote Mobile Approval**（移动审批） | Codex Remote GA | P2 |
| G27-19 | **Noise Protocol E2E Encryption** | Codex v0.141 | P2 |
| G27-20 | **DigitalOcean Plugin** | Codex Remote GA | P2 |
| G27-21 | **Document Checkpointing in Tools** | Claude Code | P2 |

---

## 十一、本次 Cycle 27 落地规划

### 11.1 P0 核心目标（6 项）

1. **G27-01 Nested Sub-Agents**：3 层嵌套 + 独立 context window
2. **G27-02 Agent Checkpointing**：tree state 保存与恢复
3. **G27-03 Path-Based Addressing**：`/root/researcher/summarizer` 层级路径
4. **G27-04 Structured Messaging**：`send_message` / `followup_task` 协议
5. **G27-05 Agent Template System**：模板定义 + 内置模板 + marketplace 占位
6. **G27-06 Remote/QR Relay Mock**：架构占位 + 完整 UI mock

### 11.2 P1 增强目标（10 项）

7. **G27-07 Scoped Permissions**：每个 sub-agent 独立工具白名单
8. **G27-08 Streaming Agent Logs**：嵌套日志流 + 时间线
9. **G27-09 Per-Agent Cost Budgets**：预算执行 + 告警
10. **G27-10 Multi-Repo Orchestration**：跨仓库依赖图 + 协调
11. **G27-11 fallbackModel Chain**：模型链回退
12. **G27-12 Skills System**：Markdown 程序性工作流
13. **G27-13 /import 模拟**：从 Cursor/Claude Code 迁移配置
14. **G27-14 History Snip Tool**：显式消息丢弃
15. **G27-15 Microcompact 落盘**：大 tool result 持久化
16. **G27-16 Permission Profiles**：细粒度文件系统控制

### 11.3 验收标准

- [ ] 6 个 P0 引擎 + UI 完成
- [ ] 10 个 P1 引擎 + UI 完成
- [ ] 每个 P0 至少 30 单元测试 + 10 组件测试
- [ ] 端到端 E2E 测试覆盖主要工作流
- [ ] TypeScript 零错误
- [ ] 全部测试通过率 100%
- [ ] UI/UX 优化 + 与现有面板协同
- [ ] 文档齐全（CYCLE27_RESEARCH / GAP_ANALYSIS / SPEC / ACCEPTANCE / MODIFICATION_LOG）

---

## 十二、参考资源

### 12.1 Codex CLI 2026

- [Codex CLI Complete Guide - SegmentFault (2026-06-01)](https://segmentfault.com/a/1190000047807970)
- [Multi-Agent Orchestration v2 (2026-04-11)](https://codex.danielvaughan.com/2026/04/11/codex-cli-multi-agent-orchestration-v2-complete-guide/)
- [Remote SSH Architecture (2026-04-17)](https://codex.danielvaughan.com/2026/04/17/codex-remote-ssh-app-server-architecture/)
- [Remote GA - QR Relay, DigitalOcean Plugin (2026-06-29)](https://codex.danielvaughan.com/2026/06/29/codex-remote-ga-qr-relay-digitalocean-plugin-mobile-approval-workflow-phone-as-control-plane/)
- [Multi-Directory Workflows (2026-05-10)](https://codex.danielvaughan.com/2026/05/10/codex-cli-multi-directory-workflows-add-dir-writable-roots-cross-repo-coordination/)
- [Codex v0.145.0 Linux Install (2026-07-28)](https://blog.csdn.net/qq_36462452/article/details/163221108)
- [Codex 0.145 Import (2026-07-24)](https://anonhaven.com/news/codex-cli-nauchilsya-perenosit-nastrojki-iz-cursor-i-claude-code/)
- [Multi-threaded Orchestration (2026-07-28)](https://blog.csdn.net/weixin_44685055/article/details/161881754)

### 12.2 Claude Code 2026

- [June 2026 - 10 New Features (2026-06-24)](https://www.sitepoint.com/claude-code-june-2026-10-new-features-devs-need-to-know/)
- [Steering Claude Code - CLAUDE.md/skills/hooks/subagents (2026-06-18)](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)
- [Claude Code v2.1.150 Complete Guide (2026-07-27)](https://blog.csdn.net/weixin_45284808/article/details/161429319)
- [Claude Code Sub-Agents Docs](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Checkpointing Docs](https://code.claude.com/docs/en/checkpointing.md)
- [Claude Code Architecture (Reverse Engineered, 2026-03-31)](https://github.com/Peiyaooooo/claude-code-reverse-engineered/blob/main/architecture.md)
- [Claude Code Skills/MCP/Plugins/Hooks/Agent/Memory Deep Dive (2026-07-28)](https://blog.csdn.net/qq_46158060/article/details/159955115)
- [Claude Code Resume Mechanism (2026-07-24)](https://blog.csdn.net/universsky2015/article/details/162643916)
- [Claude Code Sub-Agents Marketplace (Hyperskill)](https://github.com/hyperskill/claude-code-marketplace/blob/main/docs/sub-agents.md)
- [Claude Code Plugins Guide (InsidePC, 2026-07-18)](https://insidepc.tech/ai/ai-agents/plaginy-claude-code)
- [Claude Code Security (Permissions/MCP/Sandbox)](https://www.datacamp.com/id/tutorial/claude-code-security)

### 12.3 TRAE 2026

- [TRAE Changelog](https://www.trae.ai/changelog)
- [TRAE IDE Introduction](https://docs.trae.ai/ide/what-is-trae)
- [TRAE Solo Beta Introduction (2026-03-31)](https://www.trae.ai/blog/new_solo_beta_0331)
- [TRAE Solo Web](https://work.trae.ai/)
- [TRAE ToolWorthy Review](https://www.toolworthy.ai/tool/trae)

---

**报告版本**: v1.0.0
**编制时间**: 2026-07-30
**编制人**: Hermes Engineering Team
