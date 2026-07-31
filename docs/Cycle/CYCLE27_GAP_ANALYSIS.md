# Cycle 27 差距分析报告

**分析日期**: 2026-07-30
**依据**: CYCLE27_CODEX_TRAE_RESEARCH.md
**目标**: 将调研发现转化为可执行的 P0/P1/P2 任务清单

---

## 一、已有能力盘点（C20-C26）

### 1.1 核心引擎清单（19 个）

| # | 引擎 | Cycle | 版本 | 状态 |
|---|------|-------|------|------|
| 1 | `ModelRouter` | C20 | v6.46.0 | ✅ 稳定 |
| 2 | `WorktreeBackendAdapter` | C20 | v6.45.0 | ✅ 稳定 |
| 3 | `JobMonitor` | C20 | v6.45.0 | ✅ 稳定 |
| 4 | `HookTemplateMarket` | C20 | v6.46.0 | ✅ 稳定 |
| 5 | `MultiConversation` | C20 | v6.45.0 | ✅ 稳定 |
| 6 | `BestOfNWorktreePanel` | C21 | v6.48.0 | ✅ 稳定 |
| 7 | `HookChainVisualizer` | C21 | v6.48.0 | ✅ 稳定 |
| 8 | `CostPredictionEngine` | C22 | v6.51.0 | ✅ 稳定 |
| 9 | `HookPerformanceAnalyzer` | C22 | v6.52.0 | ✅ 稳定 |
| 10 | `SideChatStore` | C22 | v6.53.0 | ✅ 稳定 |
| 11 | `CandidateLearningEngine` | C23 | v6.55.0 | ✅ 稳定 |
| 12 | `SessionReplayEngine` | C23 | v6.56.0 | ✅ 稳定 |
| 13 | `ProactiveSuggestionEngine` | C23 | v6.57.0 | ✅ 稳定 |
| 14 | `VoiceInputAdapter` | C24 | v6.57.0 | ✅ 稳定 |
| 15 | `GlobalMemoryEngine` | C24 | v6.58.0 | ✅ 稳定 |
| 16 | `MultiTaskOrchestrator` | C24 | v6.59.0 | ✅ 稳定 |
| 17 | `FigmaAdapter` | C24 | v6.60.0 | ✅ 稳定 |
| 18 | `AutoCodeReviewEngine` | C25 | v6.62.0 | ✅ 稳定 |
| 19 | `PRBotSimulator` | C25 | v6.63.0 | ✅ 稳定 |
| 20 | `AIPerfOptimizer` | C25 | v6.64.0 | ✅ 稳定 |
| 21 | `CsvBatchEngine` | C26 | v6.65.0 | ✅ 稳定 |
| 22 | `SmartApprovalEngine` | C26 | v6.66.0 | ✅ 稳定 |
| 23 | `MtcAdapter` | C26 | v6.67.0 | ✅ 稳定 |

### 1.2 现有 UI 面板

| 面板 | Cycle | 功能 |
|------|-------|------|
| `BrandHeader` | C24- | 主导航栏（含 22 个菜单项） |
| `AppLayout` | C24- | 主布局 + 面板容器 |
| `ErrorBoundary` | C24- | 错误边界 |
| `MultiRepoPanel` | C20 | 多仓库管理 |
| `ModelRouterPanel` | C20 | 模型路由配置 |
| `JobMonitorPanel` | C20 | 后台任务监控 |
| `HooksPanel` | C20 | 钩子模板市场 |
| `BestOfNPanel` | C21 | Best-of-N 多模型对比 |
| `HookChainPanel` | C21 | Hook 链路可视化 |
| `CostPredictionPanel` | C22 | 成本预测 |
| `SideChatPanel` | C22 | 侧边对话 |
| `CandidateLearningPanel` | C23 | 候选学习 |
| `SessionReplayPanel` | C23 | 会话回放 |
| `ProactiveSuggestionPanel` | C23 | AI 主动建议 |
| `VoiceInputPanel` | C24 | 语音输入 |
| `GlobalMemoryPanel` | C24 | 跨会话记忆 |
| `MultiTaskPanel` | C24 | 多任务编排 |
| `FigmaAdapterPanel` | C24 | Figma 转代码 |
| `AutoCodeReviewPanel` | C25 | 自动代码评审 |
| `PRBotPanel` | C25 | PR 机器人 |
| `AIPerfPanel` | C25 | AI 性能优化器 |
| `CsvBatchPanel` | C26 | CSV 批处理 |
| `SmartApprovalPanel` | C26 | 智能审批 |
| `MTCPanel` | C26 | MTC 多模任务 |

### 1.3 当前测试覆盖

- 119 个测试文件
- 2880 个测试用例
- 100% 通过率
- TypeScript 零错误

---

## 二、缺失能力详细分析

### 2.1 P0 核心能力（6 项）

#### G27-01: Nested Sub-Agents（嵌套子代理）

**来源**: Claude Code 2026-06 #1
**重要性**: ⭐⭐⭐⭐⭐

**当前差距**：
- `MultiTaskOrchestrator` 仅支持平铺并行（5-10 任务）
- 没有父子层级概念
- 没有"子代理调用子代理"的能力
- 没有每层独立 context window

**业务影响**：
- 大型项目（迁移、重构、批量修改）需要 3 层嵌套
- 父代理负责规划 → 模块代理负责执行 → 函数级代理负责改写
- 当前 Hermes 只能做 1 层调度

**核心能力需求**：
1. `max_depth: 3` 配置
2. 父子代理注册与生命周期
3. 每层独立 context window
4. 每层独立 model / reasoning_effort / constraint set
5. 父子代理消息传递
6. 嵌套深度限制与超时控制

**落地形式**：
- `utils/nestedSubAgentEngine.ts` 核心引擎
- `utils/nestedSubAgentTypes.ts` 类型定义
- `components/NestedSubAgentPanel.tsx` UI 组件
- 单元测试 + 组件测试 + E2E 测试

---

#### G27-02: Agent Checkpointing & Tree Resume（代理检查点与树恢复）

**来源**: Claude Code 2026-06 #7
**重要性**: ⭐⭐⭐⭐⭐

**当前差距**：
- `SessionReplayEngine` 只"回放"对话历史
- 不能保存 agent 树状态
- 不能从任意子代理状态恢复
- 多小时任务崩溃后必须从头开始

**业务影响**：
- 复杂任务（数小时）中断后需要从原状态继续
- 调试时可以"穿越"到任意步骤
- 与 Git commit 解耦的轻量级快照

**核心能力需求**：
1. Checkpoint 树结构：每个 sub-agent 的 progress + outputs + pending queue
2. 命名 checkpoint：`save migration-v2` / `restore migration-v2`
3. 嵌套 checkpoint 列表
4. 差异化存储：仅保存增量（diff）
5. 30 天自动清理
6. localStorage + IndexedDB 双层存储

**落地形式**：
- `utils/agentCheckpointEngine.ts` 核心引擎
- `utils/agentCheckpointTypes.ts` 类型定义
- `components/AgentCheckpointPanel.tsx` UI 组件
- 单元测试 + 组件测试 + E2E 测试

---

#### G27-03: Path-Based Multi-Agent Addressing（路径寻址）

**来源**: Codex v0.145 V2 Multi-Agent
**重要性**: ⭐⭐⭐⭐

**当前差距**：
- 任务 ID 是不透明 UUID
- 不能表达层级关系
- 不能"我向兄弟代理发消息"

**业务影响**：
- 复杂协调场景需要语义化地址
- 例如：`/root/researcher/summarizer` 比 `uuid-abc-123` 直观

**核心能力需求**：
1. Path 解析：`/root/analyzer/builder`
2. Path 验证：仅允许 3 层
3. Path → UUID 双向映射
4. 兄弟节点查询
5. 路径冲突检测

**落地形式**：
- 集成到 `nestedSubAgentEngine.ts`
- `utils/pathAddress.ts` 路径工具
- 单元测试覆盖路径解析

---

#### G27-04: Structured Agent Messaging（结构化消息协议）

**来源**: Codex v0.145 V2 send_message / followup_task
**重要性**: ⭐⭐⭐⭐

**当前差距**：
- 任务间通过 orchestrator 间接通信
- 没有"代理 A 直接给代理 B 发消息"能力
- 没有 followup_task（等待响应后继续）

**业务影响**：
- 父子代理可显式通信
- 兄弟代理可协调
- followup_task 支持"上一任务完成后立即派下一任务"

**核心能力需求**：
1. `send_message(to: path, message: string, options)` API
2. `followup_task(parentTaskId, taskConfig)` API
3. 消息持久化（持久化到 localStorage）
4. 消息状态：sent / delivered / read / replied
5. 消息重试与超时
6. 消息钩子（可监听）

**落地形式**：
- `utils/agentMessagingEngine.ts` 核心引擎
- `utils/agentMessagingTypes.ts` 类型定义
- `components/AgentMessagingPanel.tsx` UI 组件
- 单元测试 + 组件测试

---

#### G27-05: Agent Template System（代理模板系统）

**来源**: Claude Code 2026-06 #9 + Codex subagent
**重要性**: ⭐⭐⭐⭐

**当前差距**：
- 创建新任务需要"从零开始"
- 没有"基于模板"快速创建
- 没有"模板市场"分享

**业务影响**：
- 用户可一键创建 code-reviewer、debugger、custom 等模板
- 团队可共享模板
- 模板评分与下载统计

**核心能力需求**：
1. 模板定义：YAML + Markdown（参考 Claude Code subagent 格式）
2. 内置模板：code-reviewer, debugger, test-writer, refactorer, security-auditor
3. 用户自定义模板
4. 模板市场：搜索、安装、卸载、评分
5. 模板版本管理
6. 模板预览（导入前查看）

**落地形式**：
- `utils/agentTemplateEngine.ts` 核心引擎
- `utils/agentTemplateTypes.ts` 类型定义
- `components/AgentTemplatePanel.tsx` UI 组件
- 单元测试 + 组件测试

---

#### G27-06: Remote / QR Relay / Thread Handoff（远程控制 mock）

**来源**: Codex v0.130 Remote GA
**重要性**: ⭐⭐⭐⭐

**当前差距**：
- 完全无远程/移动端能力
- 用户被绑定在单一设备

**业务影响**：
- Web 端可远程查看任务状态
- 移动端可通过 QR 码配对
- 跨设备 Thread 迁移
- 远程审批

**核心能力需求（前端 mock）**：
1. WebSocket 连接管理（mock 服务器）
2. QR 码生成（jsqr + qrcode）
3. 设备配对流程
4. Thread 状态序列化
5. 远程审批 UI
6. 设备列表与权限管理

**落地形式**：
- `utils/remoteControlEngine.ts` 核心引擎
- `utils/remoteControlTypes.ts` 类型定义
- `components/RemoteControlPanel.tsx` UI 组件
- 单元测试 + 组件测试

---

### 2.2 P1 增强能力（10 项）

#### G27-07: Scoped Permissions for Sub-Agents

**核心能力**：
- 每个 sub-agent 独立工具白名单
- 工具级 allow/deny
- 继承/覆盖父代理权限
- 权限冲突解决策略（deny-wins / allow-wins）

**落地形式**：
- `utils/scopedPermissionsEngine.ts`
- `utils/scopedPermissionsTypes.ts`
- 集成到 NestedSubAgent 引擎

---

#### G27-08: Streaming Agent Logs

**核心能力**：
- 实时流式输出子代理日志
- 嵌套层级可视化（时间线 / DAG / 列表三视图）
- 父子关联回放
- 日志过滤与搜索

**落地形式**：
- `utils/streamingAgentLogsEngine.ts`
- `utils/streamingAgentLogsTypes.ts`
- `components/StreamingAgentLogsPanel.tsx`
- 复用 Cycle 21 `HookChainVisualizer` 模式

---

#### G27-09: Per-Agent Cost Budgets

**核心能力**：
- 每个 agent 独立成本预算
- 预算执行策略：block / warn / fallback-model
- 实时仪表板
- 与 CostPrediction 集成

**落地形式**：
- `utils/perAgentBudgetEngine.ts`
- `utils/perAgentBudgetTypes.ts`
- `components/PerAgentBudgetPanel.tsx`
- 复用 Cycle 22 `CostPredictionEngine`

---

#### G27-10: Multi-Repo Orchestration

**核心能力**：
- 单个会话可同时操作多个 Git 仓库
- 跨仓库依赖图分析
- 跨仓库 PR 协调（mock）
- 仓库健康度监控

**落地形式**：
- `utils/multiRepoOrchestratorEngine.ts`
- `utils/multiRepoOrchestratorTypes.ts`
- `components/MultiRepoOrchestratorPanel.tsx`
- 复用 C20 `MultiRepoSync` + C20 `Worktree`

---

#### G27-11: fallbackModel Chain

**核心能力**：
- 模型失败时自动回退
- 链式回退（primary → fallback1 → fallback2）
- 按场景配置：成本敏感 / 质量敏感
- 回退历史记录

**落地形式**：
- `utils/fallbackModelChainEngine.ts`
- 集成到 Cycle 20 `ModelRouter`
- 单元测试覆盖回退链

---

#### G27-12: Skills System（程序性工作流）

**核心能力**：
- Markdown 程序性工作流定义
- 名称/描述启动时加载，body 按需
- Token 预算管理（共享预算，超限丢弃最旧）
- 内置技能：deploy, release-checklist, code-review

**落地形式**：
- `utils/skillsEngine.ts`
- `utils/skillsTypes.ts`
- `components/SkillsPanel.tsx`
- 单元测试 + 组件测试

---

#### G27-13: /import 跨工具迁移（mock）

**核心能力**：
- 从 Cursor / Claude Code / TRAE 迁移配置
- 导入 MCP servers、插件、命令、记忆
- 导入前预览与冲突解决
- 迁移日志

**落地形式**：
- `utils/importEngine.ts`
- `utils/importTypes.ts`
- `components/ImportPanel.tsx`
- 单元测试 + 组件测试

---

#### G27-14: History Snip Tool

**核心能力**：
- 显式消息丢弃 API
- 范围选择：从这里 / 到这里 / 精确消息
- 摘要 vs 完全丢弃
- 撤销支持

**落地形式**：
- `utils/historySnipEngine.ts`
- 集成到 GlobalMemoryEngine
- 单元测试

---

#### G27-15: Microcompact 落盘策略

**核心能力**：
- per-message tool result 大小预算
- 超限自动持久化到 IndexedDB
- 仅保留指针
- 延迟加载与恢复

**落地形式**：
- `utils/microcompactEngine.ts`
- 集成到 SSEInterceptor
- 单元测试

---

#### G27-16: Permission Profiles

**核心能力**：
- 细粒度文件系统控制
- 预定义 profile：readonly / workspace-write / full-access / custom
- 项目级 / 用户级 profile
- profile 切换审计

**落地形式**：
- `utils/permissionProfileEngine.ts`
- `utils/permissionProfileTypes.ts`
- 集成到 WorktreeBackendAdapter

---

### 2.3 P2 概念验证（5 项）

| ID | 能力 | 来源 |
|----|------|------|
| G27-17 | Community Tool Marketplace | Claude Code 2026-06 #3 |
| G27-18 | Remote Mobile Approval | Codex Remote GA |
| G27-19 | Noise Protocol E2E Encryption | Codex v0.141 |
| G27-20 | DigitalOcean Plugin | Codex Remote GA |
| G27-21 | Document Checkpointing in Tools | Claude Code |

P2 项目作为概念验证，本 Cycle 不实现。

---

## 三、本次 Cycle 27 任务清单

### 3.1 P0 核心任务（6 项）

| ID | 任务 | 引擎文件 | UI 文件 | 单元测试 | 组件测试 |
|----|------|---------|---------|---------|---------|
| G27-01 | Nested Sub-Agents | nestedSubAgentEngine.ts | NestedSubAgentPanel.tsx | 35+ | 12+ |
| G27-02 | Agent Checkpointing | agentCheckpointEngine.ts | AgentCheckpointPanel.tsx | 30+ | 10+ |
| G27-03 | Path Addressing | pathAddress.ts | (集成到 G27-01) | 15+ | - |
| G27-04 | Structured Messaging | agentMessagingEngine.ts | AgentMessagingPanel.tsx | 25+ | 10+ |
| G27-05 | Agent Template | agentTemplateEngine.ts | AgentTemplatePanel.tsx | 30+ | 10+ |
| G27-06 | Remote/QR Relay | remoteControlEngine.ts | RemoteControlPanel.tsx | 25+ | 10+ |

### 3.2 P1 增强任务（10 项）

| ID | 任务 | 引擎文件 | UI 文件 | 单元测试 | 组件测试 |
|----|------|---------|---------|---------|---------|
| G27-07 | Scoped Permissions | scopedPermissionsEngine.ts | (集成 G27-01) | 15+ | - |
| G27-08 | Streaming Agent Logs | streamingAgentLogsEngine.ts | StreamingAgentLogsPanel.tsx | 20+ | 8+ |
| G27-09 | Per-Agent Budgets | perAgentBudgetEngine.ts | PerAgentBudgetPanel.tsx | 20+ | 8+ |
| G27-10 | Multi-Repo Orchestration | multiRepoOrchestratorEngine.ts | MultiRepoOrchestratorPanel.tsx | 20+ | 8+ |
| G27-11 | fallbackModel Chain | fallbackModelChainEngine.ts | (集成到 ModelRouter) | 15+ | - |
| G27-12 | Skills System | skillsEngine.ts | SkillsPanel.tsx | 20+ | 8+ |
| G27-13 | /import 跨工具迁移 | importEngine.ts | ImportPanel.tsx | 20+ | 8+ |
| G27-14 | History Snip Tool | historySnipEngine.ts | (集成 GlobalMemory) | 12+ | - |
| G27-15 | Microcompact 落盘 | microcompactEngine.ts | (集成 SSEInterceptor) | 12+ | - |
| G27-16 | Permission Profiles | permissionProfileEngine.ts | (集成 Worktree) | 12+ | - |

### 3.3 集成任务

- App.tsx: 集成 6 个 P0 面板 + 5 个 P1 面板
- BrandHeader: 添加 11 个菜单项
- AppLayout: 状态管理
- CYCLE27_E2E.test.tsx: 端到端测试

### 3.4 文档任务

- CYCLE27_CODEX_TRAE_RESEARCH.md (✅ 完成)
- CYCLE27_GAP_ANALYSIS.md (本文件)
- CYCLE27_SPEC_G27_01 ~ G27_16.md (16 个 SPEC)
- CYCLE27_ACCEPTANCE_REPORT.md
- CYCLE27_CODE_MODIFICATION_LOG.md

---

## 四、版本规划

### 4.1 版本号策略

采用 Semantic Versioning：

- **v6.68.0** - G27-01 Nested Sub-Agents
- **v6.69.0** - G27-02 Agent Checkpointing
- **v6.70.0** - G27-03/04 Path Addressing + Structured Messaging
- **v6.71.0** - G27-05 Agent Template
- **v6.72.0** - G27-06 Remote/QR Relay
- **v6.73.0** - G27-07/08/09 Scoped Permissions + Streaming Logs + Per-Agent Budgets
- **v6.74.0** - G27-10/11/12 Multi-Repo Orchestration + fallbackModel + Skills
- **v6.75.0** - G27-13/14/15/16 + E2E 集成
- **v6.76.0** - UI/UX 优化 + 文档 + 验收

### 4.2 提交策略

- 8 个功能提交
- 1 个 UI/UX 优化提交
- 1 个 E2E 测试提交
- 1 个文档 + 验收提交
- 共 11 个 commit

---

## 五、风险评估

### 5.1 技术风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 嵌套子代理循环引用 | 中 | 高 | 强制 max_depth=3 + 路径冲突检测 |
| Checkpoint 存储膨胀 | 中 | 中 | 差异存储 + 30 天清理 |
| Remote WebSocket mock 复杂 | 中 | 中 | 使用 BroadcastChannel mock |
| 多个面板同时打开性能 | 低 | 中 | 复用 ErrorBoundary + lazy load |

### 5.2 进度风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 16 个 P0+P1 任务量大 | 中 | 高 | 严格按 SPEC 编写，并行实现 |
| 测试用例不足 | 低 | 中 | 强制每个引擎 20+ 单元测试 |
| TypeScript 类型错误 | 中 | 中 | 利用已有类型扩展模式 |

### 5.3 集成风险

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 现有面板冲突 | 低 | 中 | 复用已有 panel 状态管理 |
| 性能回归 | 中 | 中 | 性能预算 + 持续监测 |

---

## 六、验收标准

### 6.1 功能验收

- [ ] 6 个 P0 引擎 + UI 完成
- [ ] 10 个 P1 引擎 + UI 完成
- [ ] 11 个新面板集成到 App.tsx
- [ ] 11 个菜单项添加到 BrandHeader
- [ ] 每个面板至少 1 个使用示例

### 6.2 质量验收

- [ ] TypeScript 零错误
- [ ] 全部测试通过率 100%
- [ ] 单元测试 300+ 个
- [ ] 组件测试 100+ 个
- [ ] E2E 测试 30+ 个
- [ ] 测试覆盖率 80%+

### 6.3 文档验收

- [ ] CYCLE27_CODEX_TRAE_RESEARCH.md (✅)
- [ ] CYCLE27_GAP_ANALYSIS.md (✅)
- [ ] 16 个 SPEC 文档
- [ ] CYCLE27_ACCEPTANCE_REPORT.md
- [ ] CYCLE27_CODE_MODIFICATION_LOG.md

### 6.4 Git 验收

- [ ] 11 个 commit 按 SPEC 顺序
- [ ] commit message 符合规范
- [ ] 无未提交变更

---

## 七、参考链接

- [CYCLE27_CODEX_TRAE_RESEARCH.md](./CYCLE27_CODEX_TRAE_RESEARCH.md)
- [Cycle 26 验收报告](./CYCLE26_ACCEPTANCE_REPORT.md)
- [Cycle 26 差距分析](./CYCLE26_GAP_ANALYSIS.md)

---

**报告版本**: v1.0.0
**编制时间**: 2026-07-30
**编制人**: Hermes Engineering Team
