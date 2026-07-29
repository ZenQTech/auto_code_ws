# Cycle 21 互联网调研报告

> **报告日期**: 2026-07-29
> **报告作者**: Hermes AI Agent
> **前序版本**: v6.45.0-v6.47.0 (Cycle 20 三大核心引擎)
> **目标版本**: v6.48.0+ (Cycle 21 引擎协同 + 链路可视化)

---

## 一、调研背景

### 1.1 前序工作总结

Cycle 20 已完成三大核心引擎 + 三大 UI 面板：
- **WorktreeManager** (v6.45.0): 7 状态 + 5 类型 + CRUD + 持久化 + Backend 抽象
- **ModelRouter** (v6.46.0): 11 分类 + 3 模式 + 5 模型 + 评分算法
- **HooksEngine v2** (v6.47.0): 10 类型 + 4 Action + 4 Fallback + 优先级

但当前三大引擎**互相独立运行**，未形成协同闭环：
- Best-of-N 多模型并行仍共用同一工作目录（v6.42.0 MultiModelExecutor）
- Worktree 创建后与 Best-of-N 没有自动绑定
- Hook 触发后用户无法可视化查看完整执行链路
- Model Router 没有成本统计，DBA 无法优化模型选型
- Hooks 系统没有模板市场，新用户需要从零编写

### 1.2 竞品新特性分析

#### 1.2.1 Cursor 3.0 (2026-04-02) - `/worktree` + `/best-of-n` 协同

**核心机制** ([Cursor 3.0 Changelog](https://cursor.com/changelog/3-0), [ByteIota 评测](https://byteiota.com/cursor-3-agents-window-parallel-execution/))：

```bash
# Worktree 隔离命令
/worktree fix the failing auth tests and update the login copy
→ git worktree add → 新分支 → Agent 在隔离目录中执行
→ /apply-worktree 合并回主分支 / /delete-worktree 清理

# Best-of-N 跨模型并行
/best-of-n sonnet, gpt, composer fix the flaky logout test
→ 三个独立 worktree + 三个模型并行
→ 父 agent 提供对比分析 → 用户选择最佳 → 合并到单次 commit
```

**`.cursor/worktrees.json` 项目级配置**：
```json
{
  "setup": {
    "commands": ["cp .env.example .env", "npm install", "npm run db:migrate"],
    "os_specific": {
      "darwin": { "commands": ["brew services restart postgresql"] },
      "linux": { "commands": ["sudo systemctl restart postgresql"] }
    }
  },
  "post_apply": { "commands": ["npm run build", "npm run test:smoke"] },
  "ignore_patterns": ["node_modules/", ".next/", "dist/"]
}
```

**多仓库支持**（[Cursor 3 论坛](https://forum.cursor.com/t/cursor-3-worktrees-best-of-n/156507/1)）：
> "Yes, this is now possible! `/worktree` and `/best-of-n` now support multi-repo!"

#### 1.2.2 Trae SOLO GA (2026-07-20) - Planned Mode + Difference View

**Planned Mode** ([AI Damn 报道](https://ai-damn.com/trae-solo-ga-unveils-game-changing-features-for-smoother-coding-1763075481934))：
- 智能映射执行路径
- 多智能体协调
- 实时进度可视化
- "始终知道项目当前状态"

**Difference View**：
- 每次新增绿色高亮
- 每次删除红色高亮
- 支持一键确认或回滚

**实时跟随模式** ([Trae Docs](https://docs.trae.ai/ide/tool-panels))：
- AI 工作阶段自动切换工具
- 文档工具展示 PRD 生成过程
- 编辑器工具展示代码编写过程
- 终端工具展示命令执行过程
- AI 处理任务时工具只读
- 手动干预需先关闭实时跟随

#### 1.2.3 Trae 工具面板架构

| 工具 | 描述 |
|------|------|
| 编辑器 | 展示编码过程和最终代码，可查看变更 |
| 文档 | 展示 PRD/技术架构文档生成过程 |
| 终端 | 展示命令执行过程和结果 |
| 浏览器 | 展示最终 Web 应用成果，可选元素发给 AI |
| 代码变更 | 展示当前任务的代码变更情况 |
| MCP | 管理 MCP Server |
| 智能体 | 查看/管理自定义智能体 |

---

## 二、调研结论

### 2.1 五项关键能力差距

| 差距项 | 严重程度 | 竞品实现 | 业务影响 | Hermes 现状 |
|--------|----------|----------|----------|-------------|
| **Best-of-N × Worktree 协同** | P0 极高 | Cursor 3.0 `/best-of-n` | 候选仍污染主分支、无法安全对比 | MultiModelExecutor 独立运行，未与 WorktreeManager 联动 |
| **Hook 执行链路可视化** | P0 高 | Trae 实时跟随 + Cursor Hooks | 调试困难、问题定位靠猜 | HooksEngine 只有执行日志，无图形化链路 |
| **模型路由成本统计** | P1 中 | Cursor Router Stats | 成本失控、选型无依据 | ModelRouter 有 decisionLog 但无聚合分析 |
| **Worktree 远程后端** | P1 中 | Cursor Cloud Worktree | 无法支持云端执行 | 只有 MockWorktreeBackend，无真实 Git 适配层 |
| **Hook 模板市场** | P1 中 | Cursor Hooks Marketplace | 新用户配置成本高 | 无预置模板，需手写 Hook |

### 2.2 Cycle 21 目标

完成 **5 项差距** 的完整闭环：
- **P0 双核心协同**：Best-of-N × Worktree 协同 + Hook 链路可视化
- **P1 三体验优化**：模型成本统计 + Worktree 远程后端 + Hook 模板市场

每个任务必须达到：
- ✅ 完整中文文件头注释
- ✅ 单元测试覆盖率 ≥ 80%
- ✅ E2E 测试断言 100% 通过
- ✅ TypeScript 零错误
- ✅ Loop Engineering 工作流完整性保留

---

## 三、技术调研

### 3.1 Best-of-N × Worktree 协同架构

#### 3.1.1 Cursor 3.0 实现要点

**单 Worktree 模式** (`/worktree`)：
```
[用户输入 prompt] → [WorktreeManager.create()] → [git worktree add] 
→ [Agent 在 worktree 中执行] → [执行结果存储在 worktree]
→ [用户选择 /apply-worktree 合并 / /delete-worktree 丢弃]
```

**Best-of-N 多 Worktree 模式** (`/best-of-n`):
```
[用户输入 prompt + 候选模型列表] → [对每个模型创建独立 worktree]
→ [并行执行所有模型] → [收集所有 worktree 变更]
→ [父 Agent 生成对比分析] → [用户选择最佳]
→ [合并选中的 worktree 变更到主分支]
```

#### 3.1.2 Hermes 协同方案

**核心抽象**：`BestOfNWorktreeCoordinator`

```typescript
interface BestOfNWorktreeCoordinator {
  // 启动协同任务
  launch(
    prompt: string,
    candidateModels: string[],  // ['claude-sonnet-4.5', 'gpt-5', 'gemini-2.0-flash']
    options: CoordinatorOptions
  ): Promise<CoordinatorSession>;
  
  // 获取候选 worktree 状态
  getCandidateStates(sessionId: string): CandidateState[];
  
  // 对比候选结果
  compareCandidates(sessionId: string): Promise<ComparisonResult>;
  
  // 应用某个候选
  applyCandidate(sessionId: string, candidateId: string): Promise<ApplyResult>;
  
  // 丢弃某个候选
  discardCandidate(sessionId: string, candidateId: string): Promise<void>;
}
```

**数据流**：
```
BestOfNWorktreeCoordinator
  ├─ for each model:
  │   ├─ WorktreeManager.createWorktree({ type: 'best-of-n-candidate', candidateId })
  │   ├─ MultiModelExecutor.execute({ model, worktreePath })
  │   └─ 记录到 CandidateState
  ├─ Wait all complete
  └─ Aggregate → ComparisonResult
```

#### 3.1.3 关键技术点

1. **Worktree 池管理**：避免每次 Best-of-N 都创建新 worktree，复用 idle worktree
2. **结果缓存**：相同 prompt+model 组合复用上次结果
3. **资源限制**：限制最大并发 worktree 数（默认 4）
4. **冲突解决**：merge 时检测冲突，支持手动解决

### 3.2 Hook 执行链路可视化

#### 3.2.1 需求分析

当前 HooksEngine 已有：
- `trigger()` 方法触发事件
- `getExecutionLog()` 获取执行日志
- 每次执行返回 `HookExecutionResult`

但用户无法直观看到：
- 哪些 hook 被触发
- 触发顺序
- 耗时分布
- 失败原因
- 事件传播链

#### 3.2.2 链路数据结构

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
  triggeredBy?: HookChainNode[];
  error?: string;
  result?: unknown;
  depth: number;  // 嵌套深度
}
```

#### 3.2.3 可视化方案

**时间线视图（Timeline）**：
```
0ms   100ms  200ms  300ms  400ms
├─ before_prompt #1  ─────┤
│  └─ callback   ──┤
├─ thinking #1     ─────────────┤
│  └─ subagent_start  ──┤
│     └─ tool_execution  ──┤
└─ turn_complete #1  ─────┤
```

**DAG 视图**：
- 节点代表 hook 执行
- 边代表触发关系
- 颜色编码状态（绿/黄/红）
- 缩放/平移支持

**火焰图视图**：
- 堆叠条形图
- 高度代表耗时
- 点击查看详情

### 3.3 模型路由成本统计

#### 3.3.1 核心指标

```typescript
interface ModelCostStats {
  totalDecisions: number;
  totalCost: number;  // USD
  totalTokens: { input: number; output: number };
  byModel: Record<string, {
    count: number;
    cost: number;
    tokens: { input: number; output: number };
    avgComplexity: number;
    successRate: number;
  }>;
  byCategory: Record<TaskCategory, {
    count: number;
    cost: number;
    topModel: string;
  }>;
  byDay: Array<{
    date: string;  // YYYY-MM-DD
    decisions: number;
    cost: number;
  }>;
  costTrend: 'up' | 'down' | 'stable';
}
```

#### 3.3.2 应用场景

1. **成本控制**：超阈值告警
2. **模型选型优化**：识别"过度使用高端模型"场景
3. **预算规划**：基于历史趋势预测月度成本
4. **A/B 测试**：对比不同路由模式的成本差异

### 3.4 Worktree 远程后端

#### 3.4.1 架构设计

```typescript
interface WorktreeBackend {
  // 创建 worktree
  create(options: CreateWorktreeOptions): Promise<WorktreeInfo>;
  // 列出 worktree
  list(): Promise<WorktreeInfo[]>;
  // 获取
  get(id: string): Promise<WorktreeInfo | null>;
  // 删除
  remove(id: string): Promise<void>;
  // 合并
  merge(id: string, options?: MergeOptions): Promise<MergeResult>;
  // 差异
  diff(id: string): Promise<string>;
  // 清理
  cleanup(options?: CleanupOptions): Promise<number>;
}

class LocalGitWorktreeBackend implements WorktreeBackend {
  // 使用 simple-git / nodegit / child_process 真实执行 git worktree
}

class RemoteWorktreeBackend implements WorktreeBackend {
  // 通过 fetch 调用后端 API
  // 支持云端 worktree
}

class HybridWorktreeBackend implements WorktreeBackend {
  // 本地优先，失败后 fallback 远程
}
```

#### 3.4.2 配置驱动

```json
// .hermes/worktree-backend.json
{
  "defaultBackend": "local-git",
  "backends": {
    "local-git": { "type": "local", "command": "git" },
    "remote-cloud": { "type": "remote", "url": "https://api.hermes.dev/worktree", "token": "${HERMES_API_TOKEN}" }
  }
}
```

### 3.5 Hook 模板市场

#### 3.5.1 预置模板分类

**代码质量类**：
- ESLint 自动检查
- Prettier 自动格式化
- TypeScript 类型检查
- 文件大小限制

**测试类**：
- 单元测试自动运行
- 覆盖率检查
- 集成测试触发
- E2E 测试触发

**Git 类**：
- pre-commit 检查
- 提交信息规范校验
- 自动添加 issue 引用
- 敏感信息扫描

**协作类**：
- Slack 通知
- Email 通知
- 飞书 Webhook
- 钉钉 Webhook

#### 3.5.2 模板数据结构

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

---

## 四、技术方案

### 4.1 总体架构

```
                    ┌─────────────────────────────────────────┐
                    │     Hermes Cycle 21 架构                │
                    └─────────────────────────────────────────┘
                                      │
        ┌─────────────────┬───────────┴────────────┬─────────────────┐
        │                 │                        │                 │
   ┌────▼────┐      ┌────▼────┐             ┌─────▼─────┐     ┌─────▼─────┐
   │BestOfN+ │      │  Hook   │             │ ModelCost │     │  Hooks    │
   │Worktree │      │  Chain  │             │ Analytics │     │ Templates │
   │Coord.   │      │ Viewer  │             │ Dashboard │     │ Marketplace│
   └────┬────┘      └────┬────┘             └─────┬─────┘     └─────┬─────┘
        │                │                        │                 │
        └────────────────┴────────────┬───────────┴─────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │   Core Engines      │
                          │  (v6.45.0-v6.47.0)  │
                          │  - WorktreeManager  │
                          │  - ModelRouter      │
                          │  - HooksEngine v2   │
                          │  - MultiModelExec   │
                          └─────────────────────┘
```

### 4.2 数据流

**Best-of-N × Worktree 协同**：
```
User → /best-of-n command → BestOfNWorktreeCoordinator
  → for each model:
      - WorktreeManager.create()  // 隔离目录
      - MultiModelExecutor.execute()  // 在 worktree 中执行
  → 等待所有完成
  → ComparisonGenerator.compare()  // 对比分析
  → UI 展示候选列表
  → User 选择最佳
  → WorktreeManager.apply()  // 合并到主分支
```

**Hook 链路追踪**：
```
HookEvent 触发 → HooksEngine.trigger()
  → 创建 HookChain
  → 每个 hook 执行时记录 HookChainNode
  → triggerChildHook() 支持嵌套触发
  → HookChain 完成
  → 推送到 HookChainViewer
```

### 4.3 性能与安全

**性能**：
- Best-of-N worktree 池：复用 idle worktree，减少创建开销
- Hook 链路存储：环形缓冲，最多 1000 条
- 成本统计：内存聚合，1 小时持久化

**安全**：
- Worktree 路径验证：必须在配置的 worktreeRoot 内
- 远程后端鉴权：Bearer Token + 签名校验
- Hook 模板沙箱：禁止 script 类型模板执行任意代码
- 成本阈值：超过阈值需用户确认

---

## 五、参考资料

1. [Cursor 3.0 Changelog](https://cursor.com/changelog/3-0) - 官方更新日志
2. [Cursor 3 Agents Window: Parallel Execution and Worktrees](https://byteiota.com/cursor-3-agents-window-parallel-execution/) - 详细评测
3. [Cursor 3: Worktrees & Best-of-N](https://forum.cursor.com/t/cursor-3-worktrees-best-of-n/156507/1) - 官方论坛
4. [Cursor Worktree 高级配置指南](https://dredyson.com/how-i-mastered-cursor-3-worktrees-best-of-n-the-hidden-truth-about-advanced-techniques-that-pros-dont-want-you-to-know-complete-configuration-guide-with-proven-workarounds-for-multi-rep/) - 高级配置
5. [TRAE SOLO GA 新特性](https://ai-damn.com/trae-solo-ga-unveils-game-changing-features-for-smoother-coding-1763075481934) - SOLO GA 报道
6. [Trae 工具面板文档](https://docs.trae.ai/ide/tool-panels) - 官方文档
7. [Cursor 3.0 i18n 实测](https://www.mitsue.co.jp/knowledge/blog/x-tech/202604/27_0954.html) - 实际使用案例

---

**报告完成日期**: 2026-07-29
**下一步**: 创建 [CYCLE21_GAP_ANALYSIS.md](CYCLE21_GAP_ANALYSIS.md) 和 SPEC 文档
**负责人**: Hermes AI Agent
