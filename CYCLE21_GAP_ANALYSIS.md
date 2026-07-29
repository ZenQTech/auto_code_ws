# Cycle 21 差距分析报告

> **报告日期**: 2026-07-29
> **基础调研**: [CYCLE21_RESEARCH_REPORT.md](CYCLE21_RESEARCH_REPORT.md)
> **前序版本**: v6.45.0-v6.47.0 (Cycle 20 三大核心引擎)
> **目标版本**: v6.48.0+ (Cycle 21 引擎协同 + 链路可视化)

---

## 一、现状评估

### 1.1 Cycle 20 三大引擎的局限

| 引擎 | 现状 | 协同缺失 |
|------|------|----------|
| WorktreeManager (v6.45.0) | 独立运行 | 不知道 Best-of-N 在执行，无 pool 概念 |
| ModelRouter (v6.46.0) | 路由决策 | 无成本统计，无趋势分析 |
| HooksEngine v2 (v6.47.0) | 10 类型 hook | 无链路追踪，可视化缺失 |
| MultiModelExecutor (v6.42.0) | 多模型并行 | 与 WorktreeManager 完全脱节 |

### 1.2 5 项关键差距

| 编号 | 差距项 | 严重度 | 业务影响 | 优先级 |
|------|--------|--------|----------|--------|
| G21-01 | Best-of-N × Worktree 协同 | P0 | 候选仍污染主分支 | **最高** |
| G21-02 | Hook 执行链路可视化 | P0 | 调试困难、问题定位靠猜 | **高** |
| G21-03 | 模型路由成本统计 | P1 | 成本失控 | 中 |
| G21-04 | Worktree 远程后端 | P1 | 无法云端执行 | 中 |
| G21-05 | Hook 模板市场 | P1 | 新用户配置成本高 | 中 |

---

## 二、P0 双核心协同差距分析

### 2.1 G21-01 Best-of-N × Worktree 协同（极高优先级）

#### 2.1.1 现状

当前 MultiModelExecutor（v6.42.0）虽支持多模型并行，但所有候选共用**同一工作目录**：
- 并行写入同一文件导致冲突
- 任一候选失败可能污染主分支
- 用户难以对比候选效果（修改被覆盖）
- 难以回滚单次候选的修改

WorktreeManager（v6.45.0）虽然提供隔离能力，但与 Best-of-N 没有自动绑定：
- 用户需手动为每个候选创建 worktree
- 创建/销毁/合并状态没有统一管理
- 候选结果对比需要人工切换目录

#### 2.1.2 竞品实现

**Cursor 3.0 `/best-of-n`** ([changelog](https://cursor.com/changelog/3-0))：
> runs the same task in parallel across multiple models, each in its own isolated worktree, then compares outcomes.

**实测案例**（[Mitsue Blog](https://www.mitsue.co.jp/knowledge/blog/x-tech/202604/27_0954.html)）：
- 3 个候选 worktree 并行执行
- 完成后自动生成对比分析
- 用户选择最佳后合并到主分支

#### 2.1.3 Hermes 协同方案

**核心引擎**：`BestOfNWorktreeCoordinator`

**核心数据流**：
```
launch(prompt, [model1, model2, model3])
  ↓
for each model:
  ├─ WorktreeManager.create({ type: 'best-of-n-candidate' })
  ├─ MultiModelExecutor.execute({ worktreePath })
  └─ record CandidateState
  ↓
Promise.all → 全部完成
  ↓
generateComparison() → ComparisonResult
  ↓
UI 展示 → 用户选择
  ↓
WorktreeManager.apply() 或 discard()
```

**关键设计**：
1. **Worktree 池**：避免每次创建销毁，复用 idle worktree
2. **结果缓存**：相同 prompt+model 组合复用上次结果（TTL 5min）
3. **资源限制**：最大并发 worktree 数（默认 4，可配置）
4. **进度追踪**：每个候选独立 status，独立取消

#### 2.1.4 验收标准

- ✅ `BestOfNWorktreeCoordinator.launch()` 创建 N 个 worktree
- ✅ `BestOfNWorktreeCoordinator.getCandidateStates()` 返回所有候选状态
- ✅ `BestOfNWorktreeCoordinator.compareCandidates()` 生成对比分析
- ✅ `BestOfNWorktreeCoordinator.applyCandidate()` 合并最佳 worktree
- ✅ `BestOfNWorktreeCoordinator.discardCandidate()` 清理非选中 worktree
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ BestOfNCoordinatorPanel UI 完整集成

### 2.2 G21-02 Hook 执行链路可视化（高优先级）

#### 2.2.1 现状

HooksEngine v2（v6.47.0）已有：
- `trigger()` 方法触发事件
- `getExecutionLog()` 获取执行日志
- 每次执行返回 `HookExecutionResult`

但用户无法直观看到：
- 哪些 hook 被触发
- 触发顺序
- 耗时分布
- 失败原因
- 嵌套事件传播链

#### 2.2.2 竞品实现

**Trae 实时跟随模式** ([Trae Docs](https://docs.trae.ai/ide/tool-panels))：
> 开启后，系统会根据 AI 当前的工作阶段自动切换工具并实时展示工作进度和产物

**Cursor Hooks 调试**：
> Detailed diagnostics via `OPENVIKING_DEBUG=1` and inspect `~/.openviking/logs/cursor-hooks.log`

#### 2.2.3 Hermes 链路可视化方案

**核心引擎**：`HookChainTracker`（扩展 HooksEngine）

**核心数据结构**：
```typescript
interface HookChain {
  chainId: string;
  rootEvent: HookEvent;
  nodes: HookChainNode[];
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  status: 'running' | 'success' | 'failed' | 'partial';
}

interface HookChainNode {
  nodeId: string;
  hookId: string;
  hookName: string;
  hookType: HookType;
  status: HookExecutionStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  parentNodeId?: string;
  triggeredBy?: string;
  error?: string;
  depth: number;
}
```

**可视化方案（三选一）**：
1. **Timeline 时间线**：横向条形图，按时间排列
2. **DAG 视图**：节点代表 hook，边代表触发关系
3. **火焰图**：堆叠条形图，高度代表耗时

**关键设计**：
1. **链 ID 关联**：支持嵌套 trigger 时自动关联到父链
2. **环形缓冲**：最多保留 1000 条链路
3. **导出功能**：支持导出 JSON / Mermaid 格式
4. **过滤**：按类型/状态/时间过滤

#### 2.2.4 验收标准

- ✅ `HookChainTracker.startChain()` 创建链路
- ✅ `HookChainTracker.addNode()` 添加节点
- ✅ `HookChainTracker.getChains()` 查询链路
- ✅ `HookChainTracker.exportChain()` 导出 Mermaid/JSON
- ✅ HookChainViewer UI 展示时间线 + DAG
- ✅ 单元测试覆盖率 ≥ 80%

---

## 三、P1 三体验优化差距分析

### 3.1 G21-03 模型路由成本统计

#### 3.1.1 现状

ModelRouter（v6.46.0）已有 `getDecisionLog()` 但：
- 没有按模型聚合成本
- 没有按时间维度趋势
- 没有可视化 Dashboard
- 没有成本阈值告警

#### 3.1.2 实施方案

**核心方法**：`ModelRouter.getCostStats()`

```typescript
interface ModelCostStats {
  totalDecisions: number;
  totalCost: number;  // USD
  byModel: Record<string, { count: number; cost: number; avgComplexity: number; successRate: number }>;
  byCategory: Record<TaskCategory, { count: number; cost: number; topModel: string }>;
  byDay: Array<{ date: string; decisions: number; cost: number }>;
  costTrend: 'up' | 'down' | 'stable';
}
```

**ModelRouterStatsPanel UI**：
- 总成本卡片
- 模型成本排行
- 任务类型成本分布
- 30 天成本趋势图

### 3.2 G21-04 Worktree 远程后端

#### 3.2.1 现状

WorktreeManager（v6.45.0）有 `MockWorktreeBackend`，但：
- 没有真实 Git 适配层
- 不支持远程 worktree
- 无统一 Backend 接口

#### 3.2.2 实施方案

**Backend 接口抽象**：

```typescript
interface WorktreeBackend {
  create(options: CreateWorktreeOptions): Promise<WorktreeInfo>;
  list(): Promise<WorktreeInfo[]>;
  get(id: string): Promise<WorktreeInfo | null>;
  remove(id: string): Promise<void>;
  merge(id: string, options?: MergeOptions): Promise<MergeResult>;
  diff(id: string): Promise<string>;
  cleanup(options?: CleanupOptions): Promise<number>;
}
```

**三个 Backend 实现**：
1. `MockWorktreeBackend`：模拟实现（已存在）
2. `LocalGitWorktreeBackend`：使用 child_process 真实执行 git 命令
3. `RemoteWorktreeBackend`：通过 fetch 调用后端 API

**配置驱动**：
```json
{
  "defaultBackend": "local-git",
  "backends": {
    "local-git": { "type": "local" },
    "remote-cloud": { "type": "remote", "url": "https://api.example.com/worktree" }
  }
}
```

### 3.3 G21-05 Hook 模板市场

#### 3.3.1 现状

HooksEngine v2（v6.47.0）支持完整 Hook 注册，但：
- 无预置模板，新用户从零编写
- 团队最佳实践难以共享
- 无模板评分/下载统计

#### 3.3.2 实施方案

**预置模板分类**（共 8 个）：

**代码质量类**：
1. **ESLint 自动检查**：before_response 触发，运行 npx eslint
2. **Prettier 自动格式化**：after_response 触发，运行 prettier --write
3. **TypeScript 类型检查**：before_prompt 触发，运行 tsc --noEmit

**测试类**：
4. **单元测试自动运行**：after_response 触发，运行 vitest
5. **覆盖率检查**：turn_complete 触发，检查覆盖率阈值

**Git 类**：
6. **提交信息规范校验**：tool_execution 触发，正则匹配 Conventional Commits
7. **敏感信息扫描**：before_response 触发，扫描 API key/password

**协作类**：
8. **Slack 通知**：turn_complete 触发，发送 Webhook

**模板数据结构**：
```typescript
interface HookTemplate {
  id: string;
  name: string;
  description: string;
  category: 'quality' | 'testing' | 'git' | 'collaboration' | 'custom';
  tags: string[];
  author: string;
  rating: number;  // 0-5
  downloads: number;
  hookDefinition: Omit<HookDefinition, 'id' | 'createdAt' | 'createdBy'>;
  installCount: number;
  verified: boolean;
}
```

**HookTemplateMarketplace UI**：
- 模板分类标签页
- 模板卡片（评分/下载数/作者）
- 一键安装/卸载
- 模板搜索/过滤

---

## 四、Cycle 21 任务分解

### 4.1 P0 双核心协同（2 个）

| 编号 | 任务 | 文件 | 行数估算 | 优先级 |
|------|------|------|----------|--------|
| G21-01 | BestOfNWorktreeCoordinator 引擎 | bestOfNCoordinator.ts | 600 | 极高 |
| G21-01 | BestOfNCoordinatorPanel UI | BestOfNCoordinatorPanel.tsx | 400 | 极高 |
| G21-02 | HookChainTracker 引擎 | hookChainTracker.ts | 500 | 高 |
| G21-02 | HookChainViewer UI | HookChainViewer.tsx | 450 | 高 |

### 4.2 P1 三体验优化（3 个）

| 编号 | 任务 | 文件 | 行数估算 | 优先级 |
|------|------|------|----------|--------|
| G21-03 | ModelCostStats + Panel | modelCostStats.ts + ModelRouterStatsPanel.tsx | 500 | 中 |
| G21-04 | WorktreeBackend 适配层 | worktreeBackend.ts (LocalGit + Remote) | 400 | 中 |
| G21-05 | HookTemplateMarketplace | hookTemplateMarketplace.ts + HooksMarketplacePanel.tsx | 500 | 中 |

### 4.3 总工作量估算

- 引擎代码：~2400 行
- UI 组件：~1500 行
- 单元测试：~1800 行
- E2E 测试：~400 行
- 文档：~2000 行
- **总计**：~8100 行

---

## 五、验收标准（汇总）

每个任务必须达到：
- ✅ 完整中文文件头注释（核心目的、执行流程、参数定义、输出格式）
- ✅ 函数级中文注释（功能、调用关系、变量定义、执行步骤）
- ✅ 关键逻辑内联注释
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ E2E 测试断言 100% 通过
- ✅ TypeScript 零错误
- ✅ App.tsx 集成 + ErrorBoundary 嵌套
- ✅ Loop Engineering 工作流完整性保留
- ✅ UI/UX 达到生产可用级别（渐变 + 动画 + Esc + 渐入）

---

**报告完成日期**: 2026-07-29
**下一步**: 创建 SPEC 文档（G21-01 / G21-02 / G21-03 / G21-04 / G21-05）
**负责人**: Hermes AI Agent
