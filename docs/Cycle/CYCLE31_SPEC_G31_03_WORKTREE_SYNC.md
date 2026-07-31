# CYCLE31 SPEC - G31-03 Worktree 状态同步（WorktreeSyncEngine）

**任务 ID**：G31-03
**版本**：v1.0.0
**日期**：2026-07-30
**优先级**：P0
**来源调研**：[CodexMonitor](https://codex.danielvaughan.com/2026/05/31/codexmonitor-multi-workspace-orchestration-tauri-app-server-protocol/)、[Codex App](https://openai.com/ko-KR/index/introducing-the-codex-app/)

---

## 一、目标

实现 `WorktreeSyncEngine`，支持跨设备/跨工作区 Worktree 状态同步，状态广播、快照恢复、冲突检测，对接 CodexMonitor 多设备、Codex App 跨会话等行业实践。

## 二、核心能力

### 2.1 状态快照

- **快照内容**：commit hash + uncommitted changes + agent 进度 + worktree 元数据
- **快照触发**：定时（默认 60s） + 手动 + 关键事件后
- **快照格式**：JSON + 可选 gzip 压缩

### 2.2 状态广播

- **事件源**：状态变更时触发（文件变更、commit、agent 进度更新）
- **订阅者**：UI 组件、其他 worktree、其他设备
- **传输**：EventEmitter（本地）+ 自定义 SyncEndpoint（远程）

### 2.3 跨设备同步

- **SyncEndpoint**：定义同步目标（WebSocket / SSE / Polling）
- **多设备**：同一用户在多设备的 worktree 自动同步
- **离线优先**：离线时本地变更排队 + 上线时同步

### 2.4 冲突检测与解决

- **冲突检测**：基于 vector clock 检测并发修改
- **冲突类型**：文件冲突、commit 冲突、agent 进度冲突
- **解决策略**：last-write-wins（默认）/ manual / CRDT（未来）

## 三、数据模型

### 3.1 Worktree 快照

```typescript
interface WorktreeSnapshot {
  id: string;
  worktreeId: string;
  timestamp: number;
  vectorClock: Record<string, number>;
  state: {
    branch: string;
    commitHash: string;
    uncommittedChanges?: Array<{ path: string; content: string; op: 'add' | 'modify' | 'delete' }>;
    agentProgress?: Record<string, any>;
    worktreeMeta: Partial<Worktree>;
  };
  deviceId: string;
  size: number;
}
```

### 3.2 状态变更

```typescript
interface StateChange {
  id: string;
  worktreeId: string;
  timestamp: number;
  type: 'file-change' | 'commit' | 'agent-progress' | 'metadata' | 'full';
  path?: string;
  payload: any;
  vectorClock: Record<string, number>;
  deviceId: string;
}
```

### 3.3 冲突记录

```typescript
interface Conflict {
  id: string;
  worktreeId: string;
  type: 'file' | 'commit' | 'agent-progress';
  paths?: string[];
  localSnapshot: WorktreeSnapshot;
  remoteSnapshot: WorktreeSnapshot;
  detectedAt: number;
  status: 'pending' | 'resolved' | 'abandoned';
  resolution?: ConflictResolution;
}

interface ConflictResolution {
  strategy: 'local' | 'remote' | 'merge' | 'manual';
  resolvedBy?: string;
  resolvedAt?: number;
  mergedContent?: any;
}
```

### 3.4 同步端点

```typescript
interface SyncEndpoint {
  id: string;
  type: 'websocket' | 'sse' | 'polling' | 'broadcast-channel';
  url?: string;
  intervalMs?: number;  // for polling
  deviceId: string;
  connected: boolean;
  lastSyncAt?: number;
}
```

## 四、核心 API

```typescript
class WorktreeSyncEngine {
  // 同步会话
  startSync(worktreeId: string, endpoint: SyncEndpoint): SyncSession
  stopSync(sessionId: string): void
  listSessions(worktreeId: string): SyncSession[]
  
  // 状态快照
  snapshot(worktreeId: string): WorktreeSnapshot
  restore(snapshotId: string): Promise<void>
  listSnapshots(worktreeId: string): WorktreeSnapshot[]
  
  // 状态广播
  publishChange(worktreeId: string, change: Omit<StateChange, 'id' | 'timestamp' | 'deviceId'>): void
  subscribe(worktreeId: string, listener: (change: StateChange) => void): () => void
  
  // 冲突处理
  detectConflict(worktreeId: string, remoteSnapshot: WorktreeSnapshot): Conflict[]
  resolveConflict(conflictId: string, resolution: ConflictResolution): void
  listConflicts(worktreeId?: string): Conflict[]
  
  // 设备管理
  registerDevice(device: DeviceInfo): void
  unregisterDevice(deviceId: string): void
  listDevices(): DeviceInfo[]
  setCurrentDevice(deviceId: string): void
  
  // 事件订阅
  on(event: SyncEventType, listener: (e: SyncEvent) => void): () => void
}
```

## 五、关键实现

### 5.1 Vector Clock

```typescript
class VectorClock {
  private clocks: Map<string, number> = new Map();
  
  increment(deviceId: string): void;
  merge(other: VectorClock): VectorClock;
  compare(other: VectorClock): 'before' | 'after' | 'concurrent';
}
```

- 每个设备维护自己的 clock
- 每次更新时 increment(own)
- 收到远程更新时 merge
- compare 返回 before/after/concurrent

### 5.2 冲突检测算法

```
本地 snapshot.localClock = {deviceA: 5, deviceB: 3}
远程 snapshot.remoteClock = {deviceA: 4, deviceB: 5}
  - deviceA: 5 > 4 (本地新)
  - deviceB: 3 < 5 (远程新)
  → concurrent → 冲突
```

### 5.3 同步传输

- **本地订阅**：EventEmitter（同步）
- **WebSocket 同步**：JSON 序列化 + 自动重连
- **BroadcastChannel**：跨 tab 同步
- **Polling**：HTTP GET 定时拉取

## 六、测试策略

| 测试维度 | 测试数 | 说明 |
|---------|--------|------|
| 快照 | 10 | 创建/恢复/列表 |
| 状态广播 | 10 | publish/subscribe |
| 同步会话 | 10 | 启动/停止/重连 |
| Vector Clock | 8 | 增/合并/比较 |
| 冲突检测 | 12 | 各种并发场景 |
| 冲突解决 | 8 | 不同策略 |
| 设备管理 | 8 | 注册/列表/当前 |
| 事件系统 | 5 | 订阅/退订 |
| 边界条件 | 10 | 离线、超时 |
| **合计** | **~81** | 单元测试 |

## 七、UI 组件

### 7.1 WorktreeSyncPanel（3 Tab 页）

1. **同步状态**：所有 worktree 的同步状态 + 实时更新
2. **设备管理**：列出所有设备 + 当前设备
3. **冲突解决**：冲突列表 + 解决向导

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| 大量状态变更导致性能问题 | 防抖 + 批量发布 + 节流 |
| 冲突检测误报 | vector clock 精确 + 用户可关闭 |
| 同步 endpoint 不稳定 | 重试 + 退避 + 离线队列 |
| CRDT 实现复杂 | 初期 LWW，预留 CRDT 接口 |

## 九、与现有能力的关系

- **WorktreeManager（Cycle 20 G20-01）**：本地 Worktree → 状态同步
- **RemoteWorktreeAdapter（G31-02）**：远程 Worktree → 状态同步
- **GlobalMemoryEngine（G24-01）**：跨会话记忆 → 状态同步存储
- **AgentCheckpoint（Cycle 27 G27-02）**：代理检查点 → 状态快照

---

**G31-03 SPEC 完成。Cycle 31 全部 SPEC 文档完成。**
