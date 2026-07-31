# Cycle 20 G20-01: Worktree Manager - 技术规范

> **任务编号**: G20-01
> **优先级**: P0 (必做)
> **日期**: 2026-07-29
> **基于**: [CYCLE20_GAP_ANALYSIS.md](./CYCLE20_GAP_ANALYSIS.md)
> **负责人**: Hermes AI Agent

---

## 一、需求背景

### 1.1 问题

- Cycle 19 的 Best-of-N 多个候选在同一文件系统上执行
- Background Tasks 并行任务也都在同一 worktree 中
- Cursor 3.0 通过 /worktree 命令实现每个候选独立 worktree
- Trae Work 也支持 Worktree 隔离功能

### 1.2 目标

- 引入 git worktree 隔离机制
- 每个 Best-of-N 候选使用独立 worktree
- Background Tasks 支持 worktree 模式
- 完成后自动合并或保留为 PR

---

## 二、核心数据结构

### 2.1 WorktreeInfo

```typescript
export interface WorktreeInfo {
  /** 唯一 ID（UUID） */
  id: string;
  /** 关联任务 ID（可选） */
  taskId?: string;
  /** 关联 Best-of-N 候选 ID（可选） */
  candidateId?: string;
  /** 仓库根目录 */
  repoPath: string;
  /** Worktree 路径 */
  worktreePath: string;
  /** 分支名 */
  branch: string;
  /** 基础 commit SHA */
  baseCommit: string;
  /** 当前 HEAD commit SHA */
  headCommit: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 状态 */
  status: 'creating' | 'ready' | 'in-use' | 'merged' | 'abandoned' | 'error';
  /** 错误信息（如果 status=error） */
  error?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}
```

### 2.2 WorktreeConfig

```typescript
export interface WorktreeConfig {
  /** 仓库根目录 */
  repoPath: string;
  /** 分支名前缀（默认 "hermes-worktree-"） */
  branchPrefix?: string;
  /** Worktree 根目录（默认 ".hermes-worktrees"） */
  worktreeRoot?: string;
  /** 是否自动清理（默认 true） */
  autoCleanup?: boolean;
  /** 保留时长（毫秒，默认 7 天） */
  retentionMs?: number;
  /** 是否在创建时执行 git fetch（默认 true） */
  fetchOnCreate?: boolean;
}
```

---

## 三、核心 API

### 3.1 WorktreeManager

```typescript
export class WorktreeManager {
  private worktrees: Map<string, WorktreeInfo> = new Map();
  private readonly eventBus: WorktreeEventBus = new WorktreeEventBus();
  private readonly config: WorktreeConfig;

  /**
   * 创建 Worktree
   */
  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo>;

  /**
   * 列出所有 Worktree
   */
  list(filter?: WorktreeFilter): WorktreeInfo[];

  /**
   * 获取单个 Worktree
   */
  get(id: string): WorktreeInfo | null;

  /**
   * 合并 Worktree 回主分支
   */
  async merge(id: string, options?: MergeOptions): Promise<MergeResult>;

  /**
   * 放弃 Worktree（清理）
   */
  async abandon(id: string, options?: AbandonOptions): Promise<void>;

  /**
   * 应用 Worktree 变更（cherry-pick 到主分支）
   */
  async apply(id: string, options?: ApplyOptions): Promise<ApplyResult>;

  /**
   * 清理过期 Worktree
   */
  async cleanup(options?: CleanupOptions): Promise<CleanupResult>;

  /**
   * 订阅事件
   */
  on(event: WorktreeEventType, handler: WorktreeEventHandler): () => void;
}
```

### 3.2 单例工厂

```typescript
export function getWorktreeManager(config?: WorktreeConfig): WorktreeManager;
export function resetWorktreeManager(): void;
```

---

## 四、生命周期

```
create()
  ↓
creating (执行 git worktree add)
  ↓
ready (worktree 创建完成)
  ↓
in-use (被任务占用)
  ↓
merged (合并回主分支)
  或
abandoned (放弃清理)
  或
error (创建失败)
```

---

## 五、与现有模块集成

### 5.1 Best-of-N 集成

```typescript
// MultiModelExecutor.execute() 改造
const candidates = req.models.map(async (model) => {
  const worktree = await worktreeManager.create({
    repoPath,
    candidateId: `bon-${model}`,
    branch: `hermes/bon-${model}-${taskId}`,
  });
  // 在 worktree 中执行模型调用
  const result = await this._runCandidateInWorktree(taskId, candidate, req, worktree);
  return { result, worktree };
});
```

### 5.2 Background Tasks 集成

```typescript
// BackgroundTaskEngine.createTask() 改造
createTask(payload, options) {
  if (options.useWorktree) {
    const worktree = await worktreeManager.create({
      repoPath,
      taskId: id,
      branch: `hermes/task-${id}`,
    });
    task.worktreeId = worktree.id;
  }
  // ...
}
```

### 5.3 Composer 集成

- Composer 每个 Edit 操作可选择 worktree 隔离
- Composer Batch Edit 自动使用 worktree

---

## 六、性能与安全

### 6.1 性能

- 创建 worktree 时间：< 1s（小仓库）
- 合并 worktree 时间：< 2s
- 内存占用：每个 worktree 元数据 < 1KB
- 持久化：localStorage（仅元数据，文件由 git 管理）

### 6.2 安全

- 路径校验：防止 worktree 路径逃逸
- 分支名校验：仅允许安全字符
- 操作审计：所有 create/merge/abandon 记录日志
- 自动清理：过期 worktree 自动 abandon

---

## 七、UI 组件

### 7.1 WorktreePanel

- 列出所有活跃 worktree
- 状态徽章（creating/ready/in-use/merged/abandoned）
- 操作按钮：查看/合并/放弃
- 过滤：按状态/任务/候选过滤

### 7.2 WorktreeCard

- 显示 worktree 元数据
- 显示关联任务/候选
- 显示 diff 统计（变更行数）
- 快捷操作：open in editor / merge / abandon

### 7.3 在 BestOfNPanel 中集成

- 每个候选卡片显示 worktree 状态
- 完成后提供 "merge candidate" 按钮
- 显示 worktree diff 预览

### 7.4 在 BackgroundTasksPanel 中集成

- 任务卡片显示 worktree 状态
- 任务列表过滤 "has-worktree"
- 批量合并/放弃操作

---

## 八、测试要求

### 8.1 单元测试 (50+)

- create / list / get / merge / abandon
- 错误场景：路径不存在、git 不可用、分支冲突
- 生命周期：creating → ready → in-use → merged
- 持久化：localStorage 读写
- 事件总线：subscribe / emit
- 边界条件：空 worktree 列表、超长分支名

### 8.2 集成测试 (30+)

- WorktreePanel 渲染 + 交互
- WorktreeCard 操作按钮
- BestOfNPanel 集成
- BackgroundTasksPanel 集成
- 与 BestOfN/BackgroundTasks 协同

### 8.3 E2E 测试 (30+ 断言)

- Section 1: WorktreeManager 引擎 (15 项)
- Section 2: WorktreePanel UI 组件 (8 项)
- Section 3: BestOfN 集成 (4 项)
- Section 4: BackgroundTasks 集成 (3 项)

---

## 九、依赖与配置

### 9.1 依赖

无需新增 npm 依赖，使用：
- Node.js child_process (执行 git 命令)
- localStorage (持久化)

### 9.2 配置

- `worktreeRoot`: `.hermes-worktrees/`（在仓库根目录）
- `branchPrefix`: `hermes-`
- `autoCleanup`: `true`
- `retentionMs`: `7 * 24 * 60 * 60 * 1000` (7 天)

### 9.3 文件清单

- `frontend/src/utils/worktreeManager.ts` (700 行)
- `frontend/src/utils/worktreeManager.test.ts` (350 行)
- `frontend/src/components/WorktreePanel.tsx` (300 行)
- `frontend/src/components/WorktreePanel.test.tsx` (200 行)
- 修改：
  - `frontend/src/utils/multiModelExecutor.ts` (+80 行)
  - `frontend/src/utils/backgroundTaskEngine.ts` (+50 行)
  - `frontend/src/components/BrandHeader.tsx` (+30 行)
  - `frontend/src/App.tsx` (+30 行)

---

## 十、验收标准

- ✅ 单元测试 50+ 100% 通过
- ✅ 集成测试 30+ 100% 通过
- ✅ E2E 断言 30+ 100% 通过
- ✅ TypeScript 编译 0 错误
- ✅ Best-of-N 集成 worktree 隔离
- ✅ Background Tasks 支持 worktree 模式
- ✅ UI 组件完整（WorktreePanel + WorktreeCard）
- ✅ 持久化支持
- ✅ 自动清理过期 worktree
- ✅ Loop Engineering 工作流无回归

---

**SPEC 完成**: 2026-07-29 14:40
**下一步**: 创建其他 5 份 SPEC + 开始 G20-01 实施
