# G35-03: TaskCheckpointEngine SPEC

> **任务 ID**: G35-03
> **任务名称**: 任务检查点引擎（Time Travel + 版本管理）
> **版本**: v1.0.0
> **日期**: 2026-07-31
> **状态**: 设计阶段

---

## 1. 概述

实现统一的任务检查点引擎，提供完整快照 + 增量快照混合策略、Time Travel 任意版本跳转、版本分支与标签管理、两版本 Diff 对比、跨设备同步能力（与 offlineFirstEngine 协同）。

## 2. 对标产品

- **Temporal**: 持久化执行 + Journal + Time Travel
- **Event Sourcing**: 事件溯源 + 状态重建
- **Git**: 版本管理 + Branch + Tag + Diff

## 3. 核心类型

### 3.1 检查点

```typescript
export interface Checkpoint {
  id: string;
  threadId: string;
  version: number;
  parentVersion?: number;
  branch: string;
  tag?: string;
  type: 'full' | 'incremental';
  state: Record<string, unknown>;
  diff?: Record<string, unknown>;  // 增量快照的 diff
  baseVersion?: number;            // 增量快照基于的版本
  size: number;                    // 序列化大小（字节）
  compressedSize?: number;
  message?: string;                // 提交信息
  createdAt: number;
  createdBy: string;
  metadata?: Record<string, unknown>;
}
```

### 3.2 版本

```typescript
export interface Version {
  version: number;
  threadId: string;
  branch: string;
  checkpointId: string;
  createdAt: number;
  createdBy: string;
  message?: string;
  tags: string[];
  parentVersion?: number;
}
```

### 3.3 分支

```typescript
export interface Branch {
  name: string;
  threadId: string;
  headVersion: number;
  createdAt: number;
  createdBy: string;
  description?: string;
  protected: boolean;
}
```

### 3.4 标签

```typescript
export interface Tag {
  name: string;
  threadId: string;
  version: number;
  createdAt: number;
  message?: string;
}
```

### 3.5 线程（Thread）

```typescript
export interface Thread {
  id: string;
  name: string;
  description?: string;
  engine: string;              // 哪个引擎创建的
  engineInstanceId: string;    // 引擎实例 ID
  createdAt: number;
  lastActivityAt: number;
  branchCount: number;
  versionCount: number;
  totalSize: number;
  metadata?: Record<string, unknown>;
}
```

### 3.6 Diff 结果

```typescript
export interface CheckpointDiff {
  fromVersion: number;
  toVersion: number;
  added: string[];            // 新增的键
  removed: string[];          // 删除的键
  modified: string[];         // 修改的键
  changes: Array<{
    path: string;
    before: unknown;
    after: unknown;
    type: 'added' | 'removed' | 'modified';
  }>;
  summary: {
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
  };
}
```

## 4. 核心 API

### 4.1 线程管理

```typescript
class TaskCheckpointEngine {
  createThread(config: Omit<Thread, 'id' | 'createdAt' | 'lastActivityAt' | 'branchCount' | 'versionCount' | 'totalSize'>): Thread;
  deleteThread(threadId: string): boolean;
  getThread(threadId: string): Thread | undefined;
  listThreads(filter?: ThreadFilter): Thread[];
}
```

### 4.2 检查点管理

```typescript
class TaskCheckpointEngine {
  // 完整快照
  saveCheckpoint(threadId: string, state: Record<string, unknown>, options?: SaveOptions): Checkpoint;
  
  // 增量快照
  saveIncremental(threadId: string, state: Record<string, unknown>, baseVersion?: number): Checkpoint;
  
  // 自动策略
  saveAuto(threadId: string, state: Record<string, unknown>): Checkpoint;
}
```

### 4.3 版本与分支

```typescript
class TaskCheckpointEngine {
  // 版本管理
  getVersion(threadId: string, version: number): Version;
  listVersions(threadId: string, filter?: VersionFilter): Version[];
  
  // 分支管理
  createBranch(threadId: string, branchName: string, fromVersion: number): Branch;
  switchBranch(threadId: string, branchName: string): void;
  deleteBranch(threadId: string, branchName: string): boolean;
  listBranches(threadId: string): Branch[];
  
  // 标签管理
  createTag(threadId: string, tagName: string, version: number, message?: string): Tag;
  deleteTag(threadId: string, tagName: string): boolean;
  getTag(threadId: string, tagName: string): Tag;
}
```

### 4.4 Time Travel

```typescript
class TaskCheckpointEngine {
  // 恢复到指定版本
  restore(threadId: string, version: number): Record<string, unknown>;
  restoreToTag(threadId: string, tagName: string): Record<string, unknown>;
  restoreToBranch(threadId: string, branchName: string): Record<string, unknown>;
  
  // Time Travel 跳转
  checkout(threadId: string, version: number): void;
}
```

### 4.5 Diff 对比

```typescript
class TaskCheckpointEngine {
  // 两版本对比
  diff(threadId: string, fromVersion: number, toVersion: number): CheckpointDiff;
  
  // 跨分支对比
  diffBranches(threadId: string, branchA: string, branchB: string): CheckpointDiff;
}
```

### 4.6 持久化与同步

```typescript
class TaskCheckpointEngine {
  // 持久化
  exportThread(threadId: string): SerializedThread;
  importThread(data: SerializedThread): Thread;
  
  // 压缩
  compress(checkpointId: string): void;
  decompress(checkpointId: string): void;
  
  // 清理
  cleanup(threadId: string, options: CleanupOptions): number;
}
```

### 4.7 高级功能

```typescript
class TaskCheckpointEngine {
  // 统计
  getStats(): CheckpointStats;
  
  // 引擎注册
  registerEngine(engineId: string, instanceId: string, threadName: string): string;
  
  // 事件订阅
  on(event: CheckpointEvent, handler: EventHandler): Unsubscribe;
}
```

## 5. 预置配置

### 5.1 自动保存策略
- 时间触发：每 5 分钟
- 步骤触发：每 10 步
- 状态变更触发：特定字段变更

### 5.2 清理策略
- 保留最近 N 个版本（默认 50）
- 保留已标签版本
- 自动压缩 7 天前版本

## 6. 事件系统

```typescript
export type CheckpointEvent =
  | 'thread-created'
  | 'thread-deleted'
  | 'checkpoint-saved'
  | 'checkpoint-deleted'
  | 'version-created'
  | 'branch-created'
  | 'branch-switched'
  | 'tag-created'
  | 'restore-completed'
  | 'sync-completed'
  | 'cleanup-completed';
```

## 7. 默认配置

```typescript
export const DEFAULT_CHECKPOINT_CONFIG = {
  maxVersionsPerThread: 100,
  autoSaveIntervalMs: 300000,  // 5 分钟
  autoSaveSteps: 10,
  autoCleanup: true,
  enableCompression: true,
  compressionAlgorithm: 'lz-string',
  enablePersistence: true,
  enableSync: true,
  storageBackend: 'indexeddb',
};
```

## 8. 单例模式

```typescript
export function getDefaultTaskCheckpointEngine(): TaskCheckpointEngine;
export function resetDefaultTaskCheckpointEngine(): void;
```

## 9. 单元测试覆盖

| 类别 | 测试数 | 覆盖点 |
|------|--------|--------|
| 工具函数 | 5 | generateXxxId + 压缩 |
| 初始化 | 3 | 默认配置 + 预置 |
| 线程管理 | 5 | create/delete/get/list |
| 完整快照 | 6 | save + 自动版本号 |
| 增量快照 | 5 | saveIncremental + base |
| 版本管理 | 6 | get/list + 父版本 |
| 分支管理 | 7 | create/switch/delete |
| 标签管理 | 5 | create/delete/get |
| Time Travel | 6 | restore + checkout |
| Diff | 6 | diff + diffBranches |
| 持久化 | 4 | export/import |
| 压缩 | 3 | compress/decompress |
| 清理 | 4 | cleanup + 保留策略 |
| 事件 | 4 | subscribe/trigger |
| 统计 | 3 | thread/version/storage |
| 引擎注册 | 3 | registerEngine |
| 单例 | 2 | getDefault/resetDefault |
| **合计** | **~77** | |

## 10. 验收标准

- ✅ 完整快照 + 增量快照混合
- ✅ Time Travel 任意版本跳转
- ✅ 分支 + 标签管理
- ✅ Diff 对比（含跨分支）
- ✅ 自动保存策略（时间/步骤/状态）
- ✅ 自动清理 + 压缩
- ✅ 跨设备同步接口
- ✅ 引擎注册（多引擎统一管理）
- ✅ 77+ 单元测试通过
- ✅ TypeScript 0 错误
- ✅ 与 `agentCheckpointEngine` / `offlineFirstEngine` 兼容

## 11. 依赖与集成

### 依赖
- `lz-string`: 压缩（已在 devDependencies 中）
- `offlineFirstEngine`: 跨设备同步（已有）

### 集成
- 可被 `workflowOrchestratorEngine` 调用（保存实例状态）
- 可被 `agentSchedulerEngine` 调用（保存调度快照）
- 可被 `agentCommunicationEngine` 调用（保存消息历史）
- UI 面板: `TaskCheckpointPanel.tsx`
