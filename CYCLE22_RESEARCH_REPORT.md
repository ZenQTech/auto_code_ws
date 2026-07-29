# Cycle 22 互联网调研报告：Cursor 3.1 / Trae SOLO 2026 新特性

> **调研周期**: Cycle 22 (v6.51.0 - v6.54.0)
> **调研日期**: 2026-07-29
> **调研范围**: Cursor 3.1 (Apr-Jul 2026) + Trae SOLO v0.1.x / IDE v3.5.x

---

## 一、调研背景

经过 Cycle 14-21 的开发，本项目已实现 Worktree 隔离、Model Router、Hooks Engine、Best-of-N 协同、Hook 链路追踪、模型成本统计、Worktree 多后端、Hook 模板市场等 8 大核心能力。本轮调研聚焦于 Cursor 3.1 和 Trae SOLO 2026 年最新发布的功能，识别差距，规划 Cycle 22 任务。

---

## 二、Cursor 3.1 新特性深度分析

### 2.1 Cursor Router（智能模型路由）

**来源**: [Cursor Changelog 2026-07-22](https://cursor.com/de/changelog)

#### 核心能力
- **Auto 模式**：每个请求自动选择最合适的模型
- **3 种优化模式**：
  - Intelligence: 顶级质量（前沿昂贵模型）
  - Balance: 高质量（日常使用的主流模型）
  - Cost: 经济模式（最优 Token 利用率）
- **请求分类**：按任务类型和复杂度分类
- **管理员设置**：团队/组激活、模式限制、默认模式、模型白/黑名单
- **多端支持**：Desktop、Web、iOS、CLI、SDK

#### 与本项目对比
| 能力 | Cursor Router | 本项目 ModelRouter |
|------|-------------|-------------------|
| 请求分类 | ✅ | ✅ |
| 3 优化模式 | ✅ Intelligence/Balance/Cost | ✅ |
| 管理员策略 | ✅ | ❌（无 Admin 控制） |
| 客户端支持 | ✅ Desktop/Web/iOS/CLI/SDK | ❌（仅前端） |
| 模型黑/白名单 | ✅ | ❌ |
| 显示/隐藏所选模型 | ✅ | ❌ |

**差距**: G22-01 - 路由优化模式增强（管理员策略 + 模型白/黑名单 + 显示控制）

### 2.2 Side-Chats & 对话搜索

**来源**: [Cursor Changelog 2026-07-10](https://cursor.com/de/changelog)

#### 核心能力
- **Side-Chats**：在主对话旁边开侧边对话，不打断主流程
- **触发方式**：`/side`、`/btw`、加号按钮
- **对话搜索**：Agent 转录可搜索
- **简化选择器**：项目/Repo 选择更简化

#### 与本项目对比
- 本项目 Sidebar 仅管理 Session，不支持 Side-Chat
- 缺少轻量级子对话能力

**差距**: G22-02 - Side Chat / Multi-Conversation 能力

### 2.3 Slack 集成增强

**来源**: [Cursor Changelog 2026-07-17](https://cursor.com/de/changelog)

#### 核心能力
- **计划展示**：Cursor 在执行前先显示计划
- **多仓库环境**：从 Slack 启动时选择多 repo 环境
- **跨频道工作流**：可在多个频道/线程中工作
- **状态更新**：执行过程中实时更新状态

#### 与本项目对比
- 缺少 Slack 集成
- 缺少计划展示（已有 PlanEditor 但未集成外部触发）

### 2.4 Cursor 3.1 Agents Window Tiled Layout

**来源**: [Cursor 3.1 Release Notes 2026-04-13](https://www.change8.dev/ai-tools/cursor/3.1)

#### 核心能力
- **Tiled Layout**：将视图拆分为多个窗格，并行运行多个 agent
- **Voice Input (Ctrl+M)**：更可靠的语音输入 + 批量 STT
- **Cloud Agents 分支选择**：启动前选择分支
- **Diff View 跳转**：从 diff 直接跳转到对应行
- **Search in Files 过滤**：include/exclude 过滤

#### 与本项目对比
- 本项目无 Tiled Layout
- 缺少语音输入
- 缺少云端分支选择

### 2.5 Cloud Agent Hooks

**来源**: [Cursor Changelog 2026-07-22](https://cursor.com/de/changelog)

#### 核心能力
- **新 Hook 类型**：
  - 观察/控制 Agent 对话本身
  - Prompts hook
  - Responses hook
  - Thinking hook
  - Subagents hook
  - Compaction hook
  - Turn completion hook

#### 与本项目对比
- 本项目 HooksEngine 已支持 before_prompt / after_prompt / before_response / after_response / thinking / subagent_start / subagent_end / compaction / turn_complete / tool_execution 10 种事件
- **缺少**：Prompts hook、Responses hook（与 before/after_prompt 部分重叠，但需要规范化命名）

### 2.6 Cursor 3.1 Plan Tabs 增强

**来源**: [Cursor 3.1 Release Notes](https://www.change8.dev/ai-tools/cursor/3.1)

#### 核心能力
- Plan tab 支持可靠加载
- Dirty tracking
- Plan changes 重新加载
- 保存、复制、导出 markdown
- 与 file tab 行为一致

#### 与本项目对比
- 本项目 PlanViewer 已有 5 个视图（Pending/Approved/Rejected/Modified/Summary）
- **缺少**：保存/复制/导出 markdown 能力

---

## 三、Trae SOLO 2026 新特性深度分析

### 3.1 Trae Worktree 特性

**来源**: [Trae Changelog 2026-05-05](https://www.trae.ai/changelog)

#### 核心能力
- **隔离 Git 环境**：每个任务独立 Git 环境
- **专属目录**：独占文件、依赖、代码变更
- **主工作区保护**：不污染主工作区

#### 与本项目对比
- 本项目 WorktreeManager 已实现相同能力
- 增强点：Trae Worktree 强调"任务级别"隔离

### 3.2 Trae Voice Discussion 语音讨论

**来源**: [Trae Changelog 2026-05-05](https://www.trae.ai/changelog)

#### 核心能力
- 交互式语音对话 AI
- 适用于需求设计、问题分析、协作场景
- 多设备连接

#### 与本项目对比
- 缺少语音输入能力
- 已有 Waveform/Timer 控件在 Trae 3.1

### 3.3 Trae Global Memory 全局记忆

**来源**: [Trae Changelog 2026-06-24](https://www.trae.ai/changelog)

#### 核心能力
- 跨对话保留上下文
- 整合到个人知识库
- 跨任务引用历史

#### 与本项目对比
- 本项目已有 Hermes Memory System（Dual-Track Persistent Memory + memory-kernel + self-improvement + memory-recall 四个 skill）
- **增强空间**：可视化知识库 + 主动记忆推荐

### 3.4 Trae Multitasking 多任务并行

**来源**: [Trae SOLO Docs](https://docs.trae.ai/ide/solo-mode)

#### 核心能力
- 单项目内同时管理多个任务
- 突破传统串行任务执行限制
- 任务状态/进度/结果独立追踪

#### 与本项目对比
- 本项目 BackgroundTasksPanel 已实现
- **增强点**：任务依赖图 + 自动并行优化

### 3.5 Trae Hooks 配置

**来源**: [Trae Changelog 2026-06-12](https://www.trae.ai/changelog)

#### 核心能力
- Settings → Hooks 配置
- 多种事件类型支持

#### 与本项目对比
- 本项目 HooksManagerPanel 已有完整 Hook 管理
- **增强点**：可视化编辑 Hook 脚本 + 测试运行

### 3.6 Trae Design Mode（v0.1.21-23）

**来源**: [Trae Changelog 2026-06-24](https://www.trae.ai/changelog)

#### 核心能力
- 一体化设计工作流工具
- 自然语言批量编辑
- 设计系统管理
- 导出设计到代码

#### 与本项目对比
- 本项目 DesignModeOverlay 已实现 6 模板 + NL 编辑
- **增强点**：设计系统管理 + 多格式代码导出

### 3.7 Trae Voice Chat Optimizations

**来源**: [Trae Changelog 2026-06-24](https://www.trae.ai/changelog)

#### 核心能力
- Web 搜索能力
- 引用项目级上下文/记忆

#### 与本项目对比
- 缺少 Voice Chat 组件
- 已有 project-level context（hermesRules）

### 3.8 Trae Repository/Branch Search

**来源**: [Trae Changelog 2026-06-24](https://www.trae.ai/changelog)

#### 核心能力
- 仓库搜索
- 分支搜索
- 移动端支持

#### 与本项目对比
- 已有 ProjectSelector / FileExplorer
- **增强点**：跨仓库搜索 + 分支选择器

---

## 四、本项目当前能力盘点（Cycle 21 完成）

### 4.1 核心引擎（19 个）
1. ✅ WorktreeManager
2. ✅ ModelRouter
3. ✅ HooksEngine
4. ✅ BestOfNWorktreeCoordinator
5. ✅ HookChainTracker
6. ✅ ModelCostStatsCollector
7. ✅ WorktreeBackend (4 后端)
8. ✅ HookTemplateMarketplace
9. ✅ BackgroundTaskEngine
10. ✅ ComposerEngine
11. ✅ ComposerEngine.plan
12. ✅ ComposerEngine.summary
13. ✅ ReferenceResolvers
14. ✅ HermesRules
15. ✅ Hermes Memory System
16. ✅ Goal Automation
17. ✅ Goal Templates
18. ✅ MultiModelExecutor
19. ✅ DesignModeController

### 4.2 UI 面板（30+）
Worktree / ModelRouter / Hooks / BestOfN / BackgroundTasks / DesignMode / Composer / MultiAgentTree / SessionRollout / OAuthConfig / StreamList / CacheStats / GoalAutomation / GoalTemplates / TraceRule / SlashCommandHelp / CustomModels / SubAgentMemory / LoopV7 / HookChain / Mcp / Compaction / Skills / AgentsMd / Cycle3 / DualCompaction / Rules / PlanEditor / BestOfNCoordinator / ModelRouterStats / HooksMarketplace

### 4.3 后端模块（50+）
8 大功能模块，146 REST 端点

---

## 五、差距分析（Cycle 22 重点）

### 5.1 优先级矩阵

| 编号 | 差距 | 优先级 | 借鉴来源 | 估时 |
|------|------|--------|----------|------|
| **G22-01** | Side Chat / Multi-Conversation 能力 | **P0** | Cursor 3.1 Side-Chats | 1.5d |
| **G22-02** | Cost Prediction 成本预测模型 | **P0** | Cursor Router 预测 | 1d |
| **G22-03** | Hook Performance Analyzer 性能分析 | **P1** | Cloud Agent Hooks 监控 | 1d |
| **G22-04** | Model Router 优化模式增强 | **P1** | Cursor Router 3 模式 | 1d |
| **G22-05** | Auto-Selection Learning 候选学习 | **P2** | Cursor /best-of-n 历史 | 1d |
| **G22-06** | Session Replay 会话回放 | **P2** | Cursor 计划展示 + 记录 | 1.5d |

### 5.2 详细差距分析

#### G22-01: Side Chat / Multi-Conversation

**问题**：
- 当前对话只能单线进行，无法在不打断主对话的情况下讨论子话题
- 探索性对话会污染主对话上下文

**解决方案**：
- 实现 SideChatManager 单例
- 支持多 Side-Chat 并行（最多 5 个）
- Side-Chat 可关联到主对话（attachable）
- 独立的上下文管理
- 关闭/归档/晋升（晋升到主对话）

**技术方案**：
```typescript
class SideChatManager {
  createSideChat(parentSessionId: string, topic: string): SideChat
  attachToMain(sideChatId: string, message: string): void
  detachFromMain(sideChatId: string): void
  promoteToMain(sideChatId: string): Session
  archiveSideChat(sideChatId: string): void
  listSideChains(parentSessionId: string): SideChat[]
  getStats(): SideChatStats
}
```

#### G22-02: Cost Prediction 成本预测

**问题**：
- 当前 ModelCostStatsCollector 仅展示历史数据
- 缺少未来成本预测
- 缺少预算预警

**解决方案**：
- 实现 CostPredictor 单例
- 支持基于线性回归的简单预测
- 支持基于指数平滑的加权预测
- 预算告警：日预算/周预算/月预算
- 趋势可视化

**技术方案**：
```typescript
class CostPredictor {
  predictDailyCost(days: number): DailyCostPrediction
  predictMonthlyCost(month: string): MonthlyCostPrediction
  setBudget(period: 'daily'|'weekly'|'monthly', amount: number): void
  getBudgetStatus(): BudgetStatus
  checkAlert(): Alert | null
}
```

#### G22-03: Hook Performance Analyzer

**问题**：
- HookChainTracker 仅展示链路结构和状态
- 缺少性能分析（慢节点、超时节点）
- 缺少优化建议

**解决方案**：
- 实现 HookPerformanceAnalyzer
- 慢节点检测：> 平均时长 2x
- 超时节点：> 配置阈值
- 失败率统计
- 优化建议生成

**技术方案**：
```typescript
class HookPerformanceAnalyzer {
  analyzeChains(): PerformanceReport
  getSlowNodes(thresholdMs: number): SlowNodeInfo[]
  getFailedNodes(): FailedNodeInfo[]
  getRecommendations(): OptimizationSuggestion[]
  exportReport(format: 'json'|'html'|'markdown'): string
}
```

#### G22-04: Model Router 优化模式增强

**问题**：
- 当前 ModelRouter 已有 cost/balance/intelligence 模式
- 缺少管理员控制（团队/组激活）
- 缺少模型白/黑名单
- 缺少显示/隐藏所选模型

**解决方案**：
- 增强 ModelRouter 配置
- 添加管理员策略接口
- 模型白/黑名单
- 显示控制

**技术方案**：
```typescript
interface RouterAdminConfig {
  enabledTeams: string[]
  allowedModes: OptimizationMode[]
  defaultMode: OptimizationMode
  modelAllowList: string[]
  modelBlockList: string[]
  showSelectedModel: boolean
}
```

#### G22-05: Auto-Selection Learning 候选学习

**问题**：
- Best-of-N 协同当前需要手动选择最佳候选
- 缺少基于历史选择的学习能力

**解决方案**：
- 记录用户每次选择（apply/discard）
- 基于历史模式学习用户偏好
- 自动推荐最佳候选

#### G22-06: Session Replay 会话回放

**问题**：
- 缺少完整会话回放能力
- 无法分享给他人
- 无法回溯调试

**解决方案**：
- 实现 SessionRecorder 单例
- 记录所有事件流
- 支持回放控制（播放/暂停/跳转/倍速）
- 支持导出/分享

---

## 六、竞品对比总结（Cycle 21 vs Cycle 22）

| 能力 | Cursor 3.1 | Trae SOLO | 本项目 Cycle 21 | 本项目 Cycle 22 目标 |
|------|-----------|-----------|-----------------|---------------------|
| 智能路由 | ✅ Router | ❌ | ✅ | ✅ + 管理员策略 |
| Side Chat | ✅ | ❌ | ❌ | ✅ **新增** |
| 成本统计 | ❌ | ❌ | ✅ | ✅ + 预测 |
| 成本预测 | ❌ | ❌ | ❌ | ✅ **新增** |
| Hook 链路 | ✅ Cloud Hooks | ✅ | ✅ | ✅ + 性能分析 |
| Hook 性能分析 | ✅ | ❌ | ❌ | ✅ **新增** |
| Best-of-N 协同 | ✅ /best-of-n | ❌ | ✅ | ✅ + 自动学习 |
| Worktree 隔离 | ✅ /worktree | ✅ | ✅ | ✅ |
| Hook 模板市场 | ❌ | ❌ | ✅ | ✅ |
| Session Replay | ❌ | ❌ | ❌ | ✅ **新增** |

---

## 七、引用来源

1. [Cursor Changelog - Router (2026-07-22)](https://cursor.com/de/changelog/router) - Cursor Router 智能模型路由
2. [Cursor Changelog - Slack Improvements (2026-07-17)](https://cursor.com/de/changelog/slack-improvements) - Slack 集成增强
3. [Cursor Changelog - Side-Chats (2026-07-10)](https://cursor.com/de/changelog/side-chat) - Side-Chats 侧边对话
4. [Cursor 3.0 Release Notes (2026-04-02)](https://cursor.com/changelog/04-02-26) - Cursor 3.0 新界面
5. [Cursor 3.1 Release Notes (2026-04-13)](https://www.change8.dev/ai-tools/cursor/3.1) - Cursor 3.1 Tiled Layout
6. [Trae SOLO Mode Docs](https://docs.trae.ai/ide/solo-mode) - SOLO 模式文档
7. [Trae Changelog (2026-07-21)](https://www.trae.ai/changelog) - Trae 最新更新日志
8. [Cursor AI 2026 New Features Guide](https://anycap.ai/page/en-US/blog/cursor-ai-2026-new-features-guide) - Cursor 2026 深度分析
9. [Cursor 3 Agent-First IDE Guide](https://www.optijara.ai/en/blog/cursor-3-agent-first-ide-enterprise-guide-2026) - 企业级 Agent IDE 指南

---

**Cycle 22 调研完成，准备进入 Phase 2 差距分析与 SPEC 创建。**
