# CYCLE 24 GAP ANALYSIS

> **调研时间**：2026-07-29
> **调研范围**：codex v0.105+ (Multi-Agent / Orchestrated Mode) + TRAE SOLO 2026 Q3 (Design Mode / Voice / Global Memory / Multitasking)
> **信息来源**：openai/codex 官方仓库、docs.trae.ai、theaiagentindex.com、aihola.com

## 调研结论

### 1. Codex CLI v0.105+ 关键新特性

| 特性 | 来源 | 描述 | 我们的实现 |
|------|------|------|-----------|
| `spawn_agents_on_csv` | [#10935](https://github.com/openai/codex/pull/10935) | 读取 CSV，为每行 fan-out 一个 sub-agent，并行执行后归并结果 | ❌ 无 |
| `report_agent_job_result` | 同上 | sub-agent 向父 agent 回报结果 | ❌ 无 |
| Sub-agent Nickname | [#12320](https://github.com/openai/codex/pull/12320) | 给每个 sub-agent 命名便于在 TUI 中识别 | ❌ 无 |
| Cleaner TUI for sub-agents | [#12327](https://github.com/openai/codex/pull/12327) | 专门的子 agent 列表 UI | ⚠️ 部分（BackgroundTasksPanel） |
| Agent Picker | [#12332](https://github.com/openai/codex/pull/12332) | 在 TUI 中选择已存在的 agent | ❌ 无 |
| Pending Approvals | [#12767](https://github.com/openai/codex/pull/12767) | 显示子 agent 的待审批 | ⚠️ 部分 |
| Orchestrated Multi-Agent Mode | [#32100](https://github.com/openai/codex/issues/32100) | 显式角色 + 阶段合同 + 工具边界 + 审批门 | ❌ 无（只有 BestOfN） |

### 2. TRAE SOLO 2026 Q3 关键新特性

| 特性 | 来源 | 描述 | 我们的实现 |
|------|------|------|-----------|
| Design Mode | theaiagentindex.com | 生成设计稿 + 导出设计到代码 | ⚠️ 部分（DesignModeOverlay 仅为覆盖层） |
| Voice Chat + Web Search | 同上 | 语音输入 + 联网搜索 | ❌ 无 |
| Global Memory | 同上 | 跨会话持久化上下文 | ⚠️ 部分（MemoryAPI + AgentContext） |
| Multitasking | [docs.trae.ai](https://docs.trae.ai/ide/solo-mode) | 单项目并发 10-20 个云端任务 | ⚠️ 部分（BackgroundTasksPanel 仅单项目串行） |
| Figma to Code | 同上 | 自动解析 Figma 设计文件转代码 | ❌ 无 |
| Supabase Service | 同上 | 集成 BaaS（数据库+认证） | ❌ 无 |
| Vercel Deployment | 同上 | 一键部署 Web 应用 | ❌ 无 |
| Payment Service (Stripe) | 同上 | 集成 Stripe 支付 | ❌ 无 |
| MCP Transport (stdio/SSE/HTTP) | theaiagentindex.com | 支持三种 MCP 传输 | ⚠️ 部分（stdio） |
| Concurrent Cloud Tasks | 同上 | 最多 20 个并发任务 | ⚠️ 部分（BackgroundTasksPanel） |

## 优先级排序

基于"实现成本/用户价值"和"对循环工程 workflow 的直接增益"两个维度，对以下功能做优先级排序：

### P0 - 必须实现（与已有功能互补，强依赖）

#### G24-01: Global Memory 跨会话记忆引擎
- **痛点**：当前所有会话上下文仅在本地 LocalStorage/SessionStorage 中，会话结束后即丢失，用户每次新建会话都要重新建立上下文
- **价值**：保留用户偏好/历史决策/项目规则，实现真正的"AI 助手"而非"AI 陌生人"
- **预估工作量**：1 个引擎 + 1 个面板 + ~40 个测试
- **依赖**：现有 useMemory hook、AgentContext

#### G24-02: Parallel Multi-Task Orchestration
- **痛点**：BackgroundTasksPanel 只支持单项目内的串行任务管理，无法在面板级并行编排多个 SOLO 任务
- **价值**：用户可以同时启动 5-10 个 vibe coding 任务并实时观察
- **预估工作量**：1 个编排引擎 + 1 个面板 + ~50 个测试
- **依赖**：BackgroundTasksEngine、WorktreePanel

### P1 - 应当实现（增强用户体验）

#### G24-03: Voice Input
- **痛点**：所有输入只能通过键盘，对移动设备/无障碍场景不友好
- **价值**：支持语音输入需求、注释、命令
- **预估工作量**：1 个语音识别适配 + ChatMainArea 集成 + ~25 个测试

#### G24-04: Figma to Code (Simplified)
- **痛点**：设计师交付 Figma 后需要手动重写为代码
- **价值**：自动解析 Figma URL，提取组件树，生成对应代码
- **预估工作量**：1 个 Figma 解析适配 + 1 个 UI 面板 + ~35 个测试
- **依赖**：需要 Figma API key 或 mock 数据

### P2 - 后期实现（领域专用）

#### G24-05: Design Mode Generation
- **痛点**：DesignModeOverlay 仅支持在已有 UI 上覆盖注释，无法生成新设计
- **价值**：根据文本描述生成 HTML/CSS 设计稿

#### G24-06: Vercel Deployment
- **痛点**：用户开发完应用后需要手动部署
- **价值**：一键部署到 Vercel

#### G24-07: One-click Stripe Payment Integration
- **价值**：快速集成支付能力

## 调研引用

1. [Codex CLI Multi-Agent Workflows v0.105.0](https://github.com/openai/codex/issues/12832) - openai/codex 官方
2. [Orchestrated multi-agent mode PoC](https://github.com/openai/codex/issues/32100) - openai/codex 官方
3. [OpenAI Codex CLI Multi-Agent Mode](https://aihola.com/article/codex-cli-multi-agent-mode) - aihola.com
4. [TRAE IDE 官方介绍](https://www.trae.ai/) - trae.ai
5. [TRAE SOLO 模式概览](https://docs.trae.ai/ide/solo-mode) - docs.trae.ai
6. [TRAE 快速开始](https://docs.trae.ai/ide/set-up-trae) - docs.trae.ai
7. [TRAE Kit Multi-Agent System](https://github.com/PedroIves/TRAE_Kit-Multi-Agents) - PedroIves
8. [Trae Agent Index 评测](https://theaiagentindex.com/agents/trae) - theaiagentindex.com

## Cycle 24 任务清单

| 任务 | 优先级 | 工作量 | 引擎 | 面板 | 测试数 | SPEC 文档 |
|------|--------|--------|------|------|--------|-----------|
| G24-01 Global Memory 跨会话记忆 | P0 | 1d | GlobalMemoryEngine | GlobalMemoryPanel | 40+ | CYCLE24_SPEC_G24_01_GLOBAL_MEMORY.md |
| G24-02 Parallel Multi-Task Orchestration | P0 | 1d | MultiTaskOrchestrator | MultiTaskOrchestrationPanel | 50+ | CYCLE24_SPEC_G24_02_MULTI_TASK.md |
| G24-03 Voice Input | P1 | 0.5d | VoiceInputAdapter | VoiceButton (集成) | 25+ | CYCLE24_SPEC_G24_03_VOICE_INPUT.md |
| G24-04 Figma to Code (Simplified) | P1 | 0.5d | FigmaAdapter | FigmaImportPanel | 35+ | CYCLE24_SPEC_G24_04_FIGMA.md |
| **小计** | - | **3d** | 4 | 4 | 150+ | 4 |

## 与循环工程 workflow 的关联

- **G24-01 Global Memory**：让 Loop Engineering 跨多个 cycle 保持上下文（项目规则、用户偏好、决策历史）
- **G24-02 Multi-Task Orchestration**：让用户能并行运行多个 vibe coding 任务（PRD + 架构 + 实现同时进行）
- **G24-03 Voice Input**：降低 Loop Engineering 的输入成本（手不方便或移动场景）
- **G24-04 Figma to Code**：让设计阶段的产物可以无缝接入 vibe coding 流程

## 下一 Cycle 计划

- **Cycle 25**: AI 主动性能优化 / 自动化代码评审 / PR Bot
- **Cycle 26**: 团队协作（Multi-user）/ 权限系统 / 审计日志
- **Cycle 27**: 知识库 / RAG 增强 / 文档自动生成

---

**调研日期**: 2026-07-29
**调研员**: Hermes AI Agent
**下一 Cycle**: Cycle 24 启动准备
