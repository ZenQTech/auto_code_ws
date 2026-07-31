# Cycle 34 SPEC: OfflineFirstEngine (离线优先工作流引擎)

> **任务编号**：G34-02
> **任务名称**：OfflineFirstEngine - 离线优先工作流引擎
> **SPEC 版本**：v1.0.0
> **编写时间**：2026-07-31
> **关联文档**：[CYCLE34_CODEX_TRAE_RESEARCH.md § 3](./CYCLE34_CODEX_TRAE_RESEARCH.md) / [CYCLE34_GAP_ANALYSIS.md § 5.2](./CYCLE34_GAP_ANALYSIS.md)

---

## 1. 任务概述

### 1.1 目标

实现完整的离线优先工作流引擎，覆盖断网检测 + 本地队列 + CRDT 同步 + 引擎降级机制，对标 Trae Solo 模式离线优先架构 + Local-First 七大原则。

### 1.2 范围

**In-Scope**:
- 网络状态检测（navigator.onLine + 主动 ping + 事件订阅）
- 本地操作队列（操作日志 + 状态机 + 持久化）
- CRDT 同步引擎（Yjs 任务状态 + Automerge 配置 - 抽象层)
- 自动同步策略（增量 delta + 冲突解决 + 重试退避）
- 引擎降级机制（基础能力本地化 + Fallback 链）
- 离线统计（离线时长 / 队列长度 / 同步延迟）
- Change Feed 集成（与 GlobalMemory / SideChat 协同）
- 事件系统

**Out-of-Scope**:
- 实际 Yjs / Automerge 二进制集成（使用 TypeScript 模拟实现 CRDT 语义）
- IndexedDB 依赖（用 localStorage 持久化 + Map 模拟）

---

## 2. 架构设计

### 2.1 类结构

```typescript
class OfflineFirstEngine {
  // 配置
  private config: OfflineFirstConfig;
  
  // 网络状态
  private networkState: NetworkState;
  private networkListeners: Set<() => void> = new Set();
  private pingTimer: any = null;
  
  // 本地队列
  private operationQueue: OperationLogEntry[] = [];
  private processedOperations: Set<string> = new Set();
  
  // CRDT 文档
  private crdtDocuments: Map<string, CRDTDocument> = new Map();
  
  // 引擎降级映射
  private engineFallbacks: Map<string, FallbackChain> = new Map();
  
  // 同步状态
  private syncState: SyncState = 'idle';
  private syncStats: SyncStats;
  
  // 持久化
  private storageKey: string;
  
  // 事件
  private listeners: Map<OfflineEvent, Set<Function>> = new Map();
}
```

### 2.2 核心数据模型

```typescript
type NetworkStatus = 'online' | 'offline' | 'unstable';
type OperationStatus = 'pending' | 'syncing' | 'completed' | 'failed' | 'cancelled';
type OperationType = 'create' | 'update' | 'delete' | 'execute' | 'message' | 'config';
type SyncState = 'idle' | 'syncing' | 'paused' | 'error';

interface NetworkState {
  status: NetworkStatus;
  lastOnline: number;          // timestamp
  lastOffline: number;         // timestamp
  latencyMs: number | null;
  consecutiveFailures: number;
  pingEndpoint: string;
}

interface OperationLogEntry {
  id: string;
  type: OperationType;
  collection: string;          // e.g. 'task', 'memory', 'config'
  targetId: string;            // e.g. task ID
  payload: any;
  status: OperationStatus;
  priority: number;            // 1-10
  attempts: number;
  maxAttempts: number;
  createdAt: number;
  scheduledFor: number;        // 可延迟执行
  lastAttempt?: number;
  error?: string;
  metadata?: Record<string, any>;
}

interface CRDTDocument {
  id: string;
  collection: string;
  type: 'counter' | 'register' | 'set' | 'map' | 'list';
  state: any;                  // CRDT 状态
  vectorClock: Map<string, number>;  // 节点时钟
  version: number;
  lastModified: number;
  history: Array<{ op: any; node: string; timestamp: number }>;
}

interface FallbackChain {
  primaryEngine: string;       // 原始引擎 ID
  fallbacks: Array<{
    engine: string;
    method: string;
    condition: 'always' | 'on-error' | 'on-resource-limit';
  }>;
  degradedFeatures: string[];
}

interface OfflineFirstConfig {
  pingEndpoint: string;        // 健康检查 URL
  pingIntervalMs: number;      // 心跳间隔
  maxQueueSize: number;        // 最大队列长度
  maxRetries: number;          // 同步失败重试次数
  retryBackoffMs: number;      // 退避基数
  syncIntervalMs: number;      // 自动同步间隔
  persist: boolean;            // 持久化到 localStorage
  autoStart: boolean;          // 自动启动网络检测
}

interface SyncStats {
  totalOperations: number;
  pendingOperations: number;
  failedOperations: number;
  completedOperations: number;
  avgSyncLatencyMs: number;
  totalSyncTime: number;
  lastSyncAt: number;
  lastSyncSuccessAt: number;
  lastSyncErrorAt: number;
}

type OfflineEvent =
  | 'network-status-changed'
  | 'operation-queued'
  | 'operation-synced'
  | 'operation-failed'
  | 'sync-started'
  | 'sync-completed'
  | 'sync-failed'
  | 'crdt-updated'
  | 'crdt-conflict-resolved'
  | 'engine-degraded'
  | 'fallback-triggered';
```

### 2.3 网络状态检测

```typescript
class NetworkDetector {
  private state: NetworkState;
  private pingTimer: any;
  
  start(): void {
    // 1. 监听 navigator.onLine
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    
    // 2. 定时主动 ping
    this.pingTimer = setInterval(() => this.ping(), this.config.pingIntervalMs);
    
    // 3. 立即执行一次
    this.ping();
  }
  
  stop(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    if (this.pingTimer) clearInterval(this.pingTimer);
  }
  
  private async ping(): Promise<void> {
    const start = Date.now();
    try {
      const response = await fetch(this.config.pingEndpoint, {
        method: 'HEAD',
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      this.state.latencyMs = Date.now() - start;
      this.handleOnline();
    } catch (err) {
      this.handleOffline();
    }
  }
  
  onChange(listener: (state: NetworkState) => void): () => void;
  getState(): NetworkState;
}
```

### 2.4 操作队列

```typescript
class OperationQueue {
  enqueue(operation: Omit<OperationLogEntry, 'id' | 'status' | 'attempts' | 'createdAt'>): OperationLogEntry;
  dequeue(operationId: string): boolean;
  getById(id: string): OperationLogEntry | undefined;
  list(filter?: { status?: OperationStatus; type?: OperationType; limit?: number }): OperationLogEntry[];
  
  // 同步管理
  markSyncing(id: string): void;
  markCompleted(id: string): void;
  markFailed(id: string, error: string): void;
  retry(id: string): boolean;
  
  // 统计
  getStats(): {
    total: number;
    pending: number;
    syncing: number;
    completed: number;
    failed: number;
    byType: Record<OperationType, number>;
  };
  
  // 持久化
  save(): void;
  load(): void;
}
```

### 2.5 CRDT 抽象层

```typescript
// LWW-Register (Last-Write-Wins)
class LWWRegister {
  private value: any;
  private timestamp: number;
  private nodeId: string;
  
  set(value: any, timestamp: number, nodeId: string): void {
    if (timestamp > this.timestamp) {
      this.value = value;
      this.timestamp = timestamp;
      this.nodeId = nodeId;
    }
  }
  
  get(): any { return this.value; }
  
  merge(other: LWWRegister): void {
    if (other.timestamp > this.timestamp) {
      this.value = other.value;
      this.timestamp = other.timestamp;
      this.nodeId = other.nodeId;
    }
  }
  
  serialize(): any;
  deserialize(data: any): void;
}

// G-Counter (Grow-only Counter)
class GCounter {
  private counts: Map<string, number> = new Map();
  
  increment(nodeId: string, amount: number = 1): void;
  value(): number;
  merge(other: GCounter): void;
  serialize(): any;
  deserialize(data: any): void;
}

// OR-Set (Observed-Remove Set)
class ORSet {
  private elements: Map<string, { value: any; added: number[]; removed: number[] }> = new Map();
  
  add(value: any, tag: number): void;
  remove(value: any, tag: number): boolean;
  has(value: any): boolean;
  values(): any[];
  merge(other: ORSet): void;
  serialize(): any;
  deserialize(data: any): void;
}

// LWW-Map (Map of LWW-Registers)
class LWWMap {
  private entries: Map<string, LWWRegister> = new Map();
  
  set(key: string, value: any, timestamp: number, nodeId: string): void;
  get(key: string): any;
  has(key: string): boolean;
  delete(key: string): void;
  keys(): string[];
  merge(other: LWWMap): void;
  serialize(): any;
  deserialize(data: any): void;
}
```

### 2.6 同步引擎

```typescript
class SyncEngine {
  private state: SyncState = 'idle';
  private stats: SyncStats;
  
  async startSync(): Promise<SyncResult> {
    this.state = 'syncing';
    const start = Date.now();
    
    try {
      const pending = this.queue.list({ status: 'pending' });
      const results: Array<{ id: string; success: boolean; error?: string }> = [];
      
      for (const op of pending) {
        if (this.isOffline()) {
          break;  // 断网时停止同步
        }
        
        try {
          this.queue.markSyncing(op.id);
          await this.syncOne(op);
          this.queue.markCompleted(op.id);
          results.push({ id: op.id, success: true });
        } catch (err) {
          this.queue.markFailed(op.id, err.message);
          results.push({ id: op.id, success: false, error: err.message });
        }
      }
      
      this.stats.lastSyncAt = Date.now();
      this.stats.lastSyncSuccessAt = Date.now();
      this.stats.totalSyncTime += Date.now() - start;
      this.state = 'idle';
      
      return { success: true, results };
    } catch (err) {
      this.stats.lastSyncErrorAt = Date.now();
      this.state = 'error';
      throw err;
    }
  }
  
  private async syncOne(op: OperationLogEntry): Promise<void> {
    // 模拟远程同步 - 由子类实现
    return new Promise((resolve, reject) => {
      setTimeout(() => Math.random() > 0.05 ? resolve() : reject(new Error('Mock failure')), 10);
    });
  }
  
  // 退避重试
  private getBackoffMs(attempts: number): number {
    return this.config.retryBackoffMs * Math.pow(2, attempts) + Math.random() * 1000;
  }
}
```

### 2.7 引擎降级机制

```typescript
class EngineFallbackRegistry {
  private fallbacks: Map<string, FallbackChain> = new Map();
  
  register(originalEngine: string, chain: FallbackChain): void;
  
  async executeWithFallback(engine: string, method: string, args: any[]): Promise<any> {
    const chain = this.fallbacks.get(engine);
    if (!chain) {
      throw new Error(`No fallback chain for engine: ${engine}`);
    }
    
    // 尝试主引擎
    try {
      return await this.invokeEngine(engine, method, args);
    } catch (err) {
      // 触发降级
      this.emit('engine-degraded', { engine, method, error: err.message });
      
      // 尝试 fallback
      for (const fallback of chain.fallbacks) {
        try {
          const result = await this.invokeEngine(fallback.engine, fallback.method, args);
          this.emit('fallback-triggered', { from: engine, to: fallback.engine });
          return { result, degraded: true, fallbackEngine: fallback.engine };
        } catch (fallbackErr) {
          continue;
        }
      }
      
      throw new Error(`All fallbacks failed for ${engine}.${method}`);
    }
  }
}
```

### 2.8 核心 API

```typescript
class OfflineFirstEngine {
  constructor(config?: Partial<OfflineFirstConfig>);
  
  // 网络管理
  start(): void;
  stop(): void;
  getNetworkState(): NetworkState;
  isOnline(): boolean;
  onNetworkChange(listener: (state: NetworkState) => void): () => void;
  async ping(): Promise<boolean>;
  
  // 操作队列
  enqueue(operation: Omit<OperationLogEntry, 'id' | 'status' | 'attempts' | 'createdAt'>): OperationLogEntry;
  cancelOperation(id: string): boolean;
  retryOperation(id: string): boolean;
  listOperations(filter?: { status?: OperationStatus; type?: OperationType; limit?: number }): OperationLogEntry[];
  
  // 同步管理
  async syncNow(): Promise<SyncResult>;
  pauseSync(): void;
  resumeSync(): void;
  getSyncState(): SyncState;
  getSyncStats(): SyncStats;
  
  // CRDT 文档管理
  createCRDT(id: string, collection: string, type: CRDTDocument['type'], initial?: any): CRDTDocument;
  getCRDT(id: string): CRDTDocument | undefined;
  updateCRDT(id: string, op: (doc: any) => void, nodeId?: string): void;
  mergeCRDT(id: string, other: any): void;
  listCRDTs(): CRDTDocument[];
  
  // 引擎降级
  registerFallback(chain: FallbackChain): void;
  async executeWithFallback(engine: string, method: string, args: any[]): Promise<any>;
  getFallbackChain(engine: string): FallbackChain | undefined;
  
  // 统计
  getStats(): {
    network: NetworkState;
    queue: { total: number; pending: number; failed: number; completed: number };
    sync: SyncStats;
    crdts: { total: number; byType: Record<CRDTDocument['type'], number> };
    fallbacks: { registered: number; triggered: number };
  };
  
  // 事件订阅
  on(event: OfflineEvent, listener: (e: any) => void): () => void;
  emit(event: OfflineEvent, data: any): void;
  
  // 持久化
  save(): void;
  load(): void;
  clear(): void;
}
```

### 2.9 预置 Fallback 链

```typescript
const PRESET_FALLBACK_CHAINS: FallbackChain[] = [
  {
    primaryEngine: 'cloud-llm',
    fallbacks: [
      { engine: 'edge-llm', method: 'generate', condition: 'on-resource-limit' },
      { engine: 'template-engine', method: 'generate', condition: 'on-error' },
    ],
    degradedFeatures: ['real-time-knowledge', 'multi-modal'],
  },
  {
    primaryEngine: 'remote-worktree',
    fallbacks: [
      { engine: 'local-worktree', method: 'create', condition: 'always' },
    ],
    degradedFeatures: ['cross-device-sync'],
  },
  {
    primaryEngine: 'web-search',
    fallbacks: [
      { engine: 'local-search', method: 'search', condition: 'always' },
      { engine: 'cache-search', method: 'search', condition: 'on-error' },
    ],
    degradedFeatures: ['real-time-results'],
  },
];
```

---

## 3. 实施步骤

### Phase 1: 数据模型 + 网络检测（30 分钟）
- 定义所有接口
- `NetworkDetector` 类 + ping 实现 + 事件订阅
- 单元测试：10 个

### Phase 2: 操作队列（30 分钟）
- `OperationQueue` + 状态机 + 持久化
- 单元测试：12 个

### Phase 3: CRDT 抽象层（40 分钟）
- `LWWRegister` / `GCounter` / `ORSet` / `LWWMap` + merge
- 单元测试：15 个

### Phase 4: CRDT 文档管理（20 分钟）
- 文档注册 + 更新 + merge
- 单元测试：10 个

### Phase 5: 同步引擎（30 分钟）
- `SyncEngine` + 退避重试 + 状态机
- 单元测试：13 个

### Phase 6: 引擎降级（20 分钟）
- `EngineFallbackRegistry` + Fallback 链
- 单元测试：8 个

### Phase 7: 统计 + 事件 + 单例（20 分钟）
- `getStats` + 事件订阅完整 + 单例
- 单元测试：7 个

**预计总测试数**：约 75-85 个

---

## 4. 验收标准

### 4.1 功能验收
- ✅ 网络状态正确检测（online / offline / unstable）
- ✅ 操作队列支持创建 / 同步 / 重试 / 取消
- ✅ 4 种 CRDT 类型正确实现（LWW / G-Counter / OR-Set / LWW-Map）
- ✅ 联网后自动同步 + 退避重试
- ✅ 引擎降级 Fallback 链正确触发
- ✅ 离线统计完整（时长 / 队列 / 延迟）

### 4.2 质量验收
- ✅ TypeScript 0 错误
- ✅ 单元测试 100% 通过
- ✅ 与 SideChat (C18) / GlobalMemory (C24) / BackgroundTask (C4) 接口兼容
- ✅ 持久化与重载一致

### 4.3 性能验收
- ✅ 操作入队 < 1ms
- ✅ 同步单个操作 < 100ms
- ✅ 支持 10000+ 操作队列

---

## 5. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| CRDT 复杂度 | 🟡 中 | 简化为 4 种基本类型 + 完整测试 |
| 同步冲突 | 🟡 中 | LWW + OR-Set 两种语义 + 显式 resolve |
| 持久化容量 | 🟢 低 | localStorage 限制 + 队列上限 |
| 引擎降级副作用 | 🟡 中 | 显式 degradedFeatures + 用户提示 |

---

## 6. 与现有模块集成点

```typescript
// GlobalMemory (C24) - CRDT 同步
OfflineFirstEngine.createCRDT('global-memory', 'memory', 'map')

// SideChat (C18) - 离线持久化
SideChat.addMessage → OfflineFirstEngine.enqueue

// BackgroundTask (C4) - 离线队列
BackgroundTask.execute → OfflineFirstEngine.enqueue

// EdgeModelRouter (G34-01) - 端云降级
EdgeModelRouterEngine.route → OfflineFirstEngine.executeWithFallback
```

---

## 7. 文件结构

```
frontend/src/utils/
  offlineFirstEngine.ts              # 核心引擎 (~1000 行)
  offlineFirstEngine.test.ts         # 单元测试 (~80 用例)
  offlineFirstTypes.ts               # 类型定义 (可选)
  crdt/
    LWWRegister.ts
    GCounter.ts
    ORSet.ts
    LWWMap.ts
```

---

## SPEC 结束

> **下一步**：基于本 SPEC 实现 `offlineFirstEngine.ts` + 单元测试
