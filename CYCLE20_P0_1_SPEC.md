# Cycle 20 P0-1 Worktree Manager 详细规范

> **创建日期**: 2026-07-29
> **任务代号**: C20-P0-1
> **目标版本**: v6.45.0
> **基于调研**: [CYCLE20_RESEARCH_REPORT.md](../CYCLE20_RESEARCH_REPORT.md) § 5.1
> **基于差距分析**: [CYCLE20_GAP_ANALYSIS.md](../CYCLE20_GAP_ANALYSIS.md) § 2.1

---

## 一、任务背景

### 1.1 问题描述

当前 Hermes 平台的 Best-of-N Multi-Model（v6.42.0）和 Background Tasks（v6.41.0）虽然支持并行执行，但所有任务共用**同一工作目录**，存在以下严重问题：

1. **并行冲突**：多个候选同时写入同一文件导致不可预期的结果
2. **分支污染**：任一失败任务可能污染主分支，无法干净回滚
3. **效果对比困难**：候选之间的修改相互覆盖，无法真实对比
4. **回滚代价高**：需要 git reflog + reset 等复杂操作

### 1.2 竞品参考

- **Cursor 3.0 `/worktree` 命令**（2026-04）：调用 `git worktree add` 隔离环境
- **Trae Work Worktree**（2026-05-05）：每个任务独立目录、依赖、代码变更

### 1.3 业务价值

- ✅ Best-of-N 候选**互不干扰**
- ✅ 失败任务可**一键丢弃**
- ✅ 用户可**逐个评估**候选效果
- ✅ 主 workspace **永远保持干净**

---

## 二、核心抽象设计

### 2.1 类型定义

```typescript
/** Worktree 类型 */
export type WorktreeType = 'local' | 'isolated' | 'review' | 'experiment';

/** Worktree 状态 */
export type WorktreeStatus =
  | 'creating'    // 创建中
  | 'ready'       // 就绪
  | 'in-use'      // 使用中（任务执行）
  | 'modified'    // 有未提交修改
  | 'merged'      // 已合并
  | 'discarded'   // 已丢弃
  | 'error';      // 错误

/** Worktree 信息 */
export interface WorktreeInfo {
  /** 唯一 ID（UUID v4） */
  id: string;
  /** 类型 */
  type: WorktreeType;
  /** 物理路径（虚拟） */
  path: string;
  /** 分支名 */
  branch: string;
  /** 基础分支 */
  baseBranch: string;
  /** 关联任务 ID */
  taskId?: string;
  /** 关联会话 ID */
  sessionId?: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后修改时间 */
  updatedAt: number;
  /** 状态 */
  status: WorktreeStatus;
  /** 文件变更统计 */
  changes?: {
    added: number;
    modified: number;
    deleted: number;
  };
  /** 描述/标签 */
  label?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/** 创建选项 */
export interface CreateWorktreeOptions {
  type?: WorktreeType;
  baseBranch?: string;
  branchName?: string;     // 自定义分支名（可选）
  taskId?: string;
  sessionId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

/** 合并选项 */
export interface MergeOptions {
  /** 目标分支（默认 baseBranch） */
  targetBranch?: string;
  /** 合并策略 */
  strategy?: 'merge' | 'rebase' | 'squash';
  /** 提交信息 */
  message?: string;
  /** 是否删除 worktree 分支 */
  deleteBranch?: boolean;
}

/** 合并结果 */
export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  commitHash?: string;
  message?: string;
}

/** Diff 结果 */
export interface DiffResult {
  files: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted';
    additions: number;
    deletions: number;
    hunks: Array<{
      startLine: number;
      endLine: number;
      content: string;
    }>;
  }>;
  totalAdditions: number;
  totalDeletions: number;
}

/** 存储接口（用于持久化） */
export interface WorktreeStorage {
  load(): WorktreeInfo[];
  save(worktrees: WorktreeInfo[]): void;
}

/** Backend 接口（用于真实 git 操作） */
export interface WorktreeBackend {
  create(options: CreateWorktreeOptions): Promise<WorktreeInfo>;
  remove(id: string): Promise<void>;
  list(): Promise<WorktreeInfo[]>;
  diff(id: string): Promise<DiffResult>;
  merge(id: string, options: MergeOptions): Promise<MergeResult>;
  status(id: string): Promise<WorktreeStatus>;
}
```

### 2.2 核心引擎

```typescript
/**
 * WorktreeManager
 * 单例工厂 + 事件总线
 */
export class WorktreeManager {
  /** 当前所有 worktree */
  private worktrees: Map<string, WorktreeInfo>;
  /** 事件订阅者 */
  private subscribers: Set<(event: WorktreeEvent) => void>;
  /** 存储后端 */
  private storage: WorktreeStorage;
  /** 操作后端（可注入 Mock 或真实） */
  private backend: WorktreeBackend;
  /** 配置 */
  private config: WorktreeManagerConfig;

  /** 创建 worktree */
  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo>;

  /** 列出所有 worktree（可按状态/类型/任务过滤） */
  list(filter?: WorktreeFilter): WorktreeInfo[];

  /** 获取单个 worktree */
  get(id: string): WorktreeInfo | null;

  /** 移除 worktree */
  async remove(id: string): Promise<void>;

  /** 合并 worktree 到目标分支 */
  async merge(id: string, options?: MergeOptions): Promise<MergeResult>;

  /** 获取 diff */
  async diff(id: string): Promise<DiffResult>;

  /** 更新状态 */
  updateStatus(id: string, status: WorktreeStatus, changes?: WorktreeInfo['changes']): void;

  /** 关联到任务 */
  attachToTask(id: string, taskId: string): void;

  /** 订阅事件 */
  subscribe(handler: (event: WorktreeEvent) => void): () => void;

  /** 清理已合并/已丢弃的 worktree */
  cleanup(): Promise<number>;
}

/** 事件类型 */
export type WorktreeEvent =
  | { type: 'created'; worktree: WorktreeInfo }
  | { type: 'status-changed'; id: string; previous: WorktreeStatus; current: WorktreeStatus }
  | { type: 'removed'; id: string }
  | { type: 'merged'; id: string; result: MergeResult }
  | { type: 'discarded'; id: string }
  | { type: 'error'; id: string; error: Error };

/** 过滤选项 */
export interface WorktreeFilter {
  status?: WorktreeStatus | WorktreeStatus[];
  type?: WorktreeType;
  taskId?: string;
  sessionId?: string;
  baseBranch?: string;
}

/** 配置 */
export interface WorktreeManagerConfig {
  /** 最大 worktree 数量（默认 10） */
  maxWorktrees?: number;
  /** 自动清理天数（默认 7） */
  autoCleanupDays?: number;
  /** 持久化 key */
  storageKey?: string;
}
```

### 2.3 工厂函数

```typescript
let _instance: WorktreeManager | null = null;

export function getWorktreeManager(): WorktreeManager {
  if (!_instance) {
    _instance = new WorktreeManager({
      backend: new MockWorktreeBackend(),
      storage: new LocalStorageWorktreeStorage('hermes.worktrees.v1'),
      config: {
        maxWorktrees: 10,
        autoCleanupDays: 7,
      },
    });
  }
  return _instance;
}

export function resetWorktreeManager(): void {
  _instance?.dispose();
  _instance = null;
}
```

---

## 三、Mock 后端实现

### 3.1 MockWorktreeBackend

```typescript
/**
 * MockWorktreeBackend
 * 模拟 git worktree 操作，用于开发/测试环境
 * 不依赖真实 git 命令，避免前端权限问题
 */
export class MockWorktreeBackend implements WorktreeBackend {
  /** 模拟文件系统 */
  private mockFiles: Map<string, string>; // worktreeId -> file tree

  async create(options: CreateWorktreeOptions): Promise<WorktreeInfo> {
    // 模拟 100-300ms 创建延迟
    await delay(100 + Math.random() * 200);

    const id = generateUUID();
    const path = `/mock/worktrees/${id}`;
    const branch = options.branchName || `wt-${id.slice(0, 8)}`;

    return {
      id,
      type: options.type || 'isolated',
      path,
      branch,
      baseBranch: options.baseBranch || 'main',
      taskId: options.taskId,
      sessionId: options.sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'ready',
      label: options.label,
      metadata: options.metadata,
      changes: { added: 0, modified: 0, deleted: 0 },
    };
  }

  async remove(id: string): Promise<void> {
    await delay(50);
    this.mockFiles.delete(id);
  }

  async list(): Promise<WorktreeInfo[]> {
    return []; // 由 Manager 内部维护
  }

  async diff(id: string): Promise<DiffResult> {
    await delay(50);
    return {
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
    };
  }

  async merge(id: string, options: MergeOptions): Promise<MergeResult> {
    await delay(200 + Math.random() * 300);
    // 5% 概率模拟冲突
    if (Math.random() < 0.05) {
      return {
        success: false,
        conflicts: ['src/components/Header.tsx', 'src/utils/api.ts'],
        message: '检测到合并冲突',
      };
    }
    return {
      success: true,
      commitHash: generateCommitHash(),
    };
  }

  async status(id: string): Promise<WorktreeStatus> {
    return 'ready';
  }
}
```

### 3.2 LocalStorageWorktreeStorage

```typescript
/**
 * LocalStorageWorktreeStorage
 * 持久化到 localStorage，最多保留最近 50 条
 */
export class LocalStorageWorktreeStorage implements WorktreeStorage {
  constructor(private key: string) {}

  load(): WorktreeInfo[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  save(worktrees: WorktreeInfo[]): void {
    try {
      // 保留最新 50 条
      const trimmed = worktrees.slice(-50);
      localStorage.setItem(this.key, JSON.stringify(trimmed));
    } catch (err) {
      console.warn('[WorktreeStorage] save failed:', err);
    }
  }
}
```

---

## 四、UI 组件设计

### 4.1 WorktreesPanel 列表管理面板

**位置**：菜单 "🌳 Worktree" 入口

**功能**：
- 列表展示所有 worktree（按状态分组：活跃/已合并/已丢弃）
- 卡片显示：分支名/类型/任务/变更统计/创建时间
- 操作按钮：查看 Diff / 合并 / 丢弃 / 删除
- 筛选器：状态 / 类型 / 任务 ID
- 排序：创建时间 / 最后更新

**布局**：
```
┌──────────────────────────────────────────────────────────┐
│ 🌳 Worktree 管理                            [+ 新建] [⟳]  │
├──────────────────────────────────────────────────────────┤
│ [全部 5] [活跃 2] [已合并 2] [已丢弃 1]                    │
│ 类型: [全部] [isolated] [review] [experiment]             │
│ 搜索: [_________________________]                          │
├──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 🌿 wt-a1b2c3d4                                    [活跃]│ │
│ │ 类型: isolated | 基于: main | 任务: best-of-n-001       │ │
│ │ 变更: +12 -3  M 5  | 创建于 2 分钟前                     │ │
│ │ [查看 Diff] [合并] [丢弃] [删除]                          │ │
│ └──────────────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 🌿 wt-e5f6g7h8                                  [已合并]│ │
│ │ ...                                                     │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 4.2 WorktreeCard 卡片组件

**Props**：
- `worktree: WorktreeInfo`
- `onViewDiff?: (id: string) => void`
- `onMerge?: (id: string) => void`
- `onDiscard?: (id: string) => void`
- `onDelete?: (id: string) => void`

**状态展示**：
- 状态徽章颜色：creating=灰 / ready=蓝 / in-use=紫 / modified=橙 / merged=绿 / discarded=灰 / error=红
- 变更统计徽章：+12 -3 形式

### 4.3 WorktreeDiffModal Diff 预览弹窗

**功能**：
- 展示 worktree 与 base branch 的 diff
- 文件列表 + 文件状态图标
- 点击文件展开 hunks
- 关闭按钮 / 底部"合并"/"丢弃"操作

### 4.4 WorktreeCreateModal 创建弹窗

**功能**：
- 选择类型：isolated / review / experiment
- 输入基础分支（默认 main）
- 输入标签（可选）
- 输入任务 ID（可选）
- 确认创建

---

## 五、BestOfNPanel 集成

### 5.1 改动点

在 `BestOfNPanel` 中：
- 新增"🌳 Worktree 隔离"开关（默认开启）
- 开启后，每个候选使用独立 worktree
- 结果展示时，附加 worktree 信息

### 5.2 数据流

```
[Best-of-N 启动] 
  → [WorktreeManager.create × N] 
  → [为每个候选分配 worktree] 
  → [候选完成后更新 worktree 状态] 
  → [用户选择最佳候选] 
  → [WorktreeManager.merge(选中候选)] 
  → [WorktreeManager.remove(其他候选)]
```

---

## 六、验收标准

### 6.1 功能验收

- ✅ `WorktreeManager.create()` 成功创建 worktree
- ✅ `WorktreeManager.list()` 支持按状态/类型/任务过滤
- ✅ `WorktreeManager.merge()` 成功合并，5% 概率返回冲突
- ✅ `WorktreeManager.remove()` 成功删除
- ✅ `WorktreeManager.diff()` 返回 diff 结果
- ✅ `WorktreeManager.subscribe()` 事件订阅生效
- ✅ `WorktreeManager.cleanup()` 自动清理过期 worktree
- ✅ localStorage 持久化 + 重启恢复
- ✅ `getWorktreeManager()` 单例工厂正确
- ✅ `resetWorktreeManager()` 清理资源

### 6.2 UI 验收

- ✅ `WorktreesPanel` 列表展示 + 筛选 + 排序
- ✅ `WorktreeCard` 状态徽章 + 变更统计 + 操作按钮
- ✅ `WorktreeDiffModal` 弹窗展示 diff
- ✅ `WorktreeCreateModal` 创建弹窗
- ✅ `BestOfNPanel` 集成 worktree 选项
- ✅ BrandHeader 菜单新增"🌳 Worktree"入口
- ✅ App.tsx 渲染 WorktreesPanel + 错误边界保护

### 6.3 测试验收

- ✅ 单元测试 ≥ 25 项（核心引擎 + Mock 后端 + 存储）
- ✅ 组件测试 ≥ 10 项（WorktreeCard / WorktreeDiffModal 等）
- ✅ E2E 测试覆盖：创建→修改→合并→清理 全流程
- ✅ TypeScript 零错误

---

## 七、文件清单

### 7.1 新增文件

| 路径 | 说明 | 行数 |
|------|------|------|
| `frontend/src/utils/worktreeManager.ts` | 核心引擎 | ~500 |
| `frontend/src/utils/worktreeManager.test.ts` | 单元测试 | ~400 |
| `frontend/src/components/WorktreesPanel.tsx` | 列表面板 | ~350 |
| `frontend/src/components/WorktreesPanel.test.tsx` | 组件测试 | ~250 |
| `frontend/src/components/WorktreeCard.tsx` | 卡片组件 | ~150 |
| `frontend/src/components/WorktreeDiffModal.tsx` | Diff 弹窗 | ~200 |
| `frontend/src/components/WorktreeCreateModal.tsx` | 创建弹窗 | ~150 |
| `tests/test_e2e_cycle20_p0_1.sh` | E2E 测试 | ~200 |

### 7.2 修改文件

| 路径 | 改动 |
|------|------|
| `frontend/src/App.tsx` | 集成 WorktreesPanel |
| `frontend/src/components/AppLayout.tsx` | 透传回调 |
| `frontend/src/components/BrandHeader.tsx` | 菜单新增"🌳 Worktree" |
| `frontend/src/components/BestOfNPanel.tsx` | worktree 选项集成 |
| `frontend/src/utils/index.ts` | 导出 worktreeManager |

---

## 八、风险与回滚

### 8.1 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| localStorage 容量超限 | 中 | 持久化失败 | 仅保留 50 条 + try/catch |
| 单例泄漏 | 低 | 内存泄漏 | resetWorktreeManager 清理 |
| BestOfN 集成破坏现有逻辑 | 中 | 回归 | 开关默认开 + 完整测试 |

### 8.2 回滚

- 通过开关控制 BestOfN 是否使用 worktree
- WorktreesPanel 独立菜单入口，可独立启用/禁用

---

**规范完成**: 2026-07-29
**下一阶段**: 实现 worktreeManager.ts
