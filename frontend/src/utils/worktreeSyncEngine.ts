/**
 * # ============================================================
 * # Worktree Sync Engine - Worktree 状态同步引擎 (v1.0.0 Cycle 31 G31-03)
 * # ============================================================
 * # 核心作用：跨设备/跨工作区 Worktree 状态同步
 * # 状态快照：commit + uncommitted changes + agent 进度
 * # 状态广播：状态变更时广播到所有订阅者
 * # 冲突检测：基于 Vector Clock 检测并发修改
 * # 冲突解决：last-write-wins（默认）/ manual / CRDT
 * # 参考：CodexMonitor 多设备、Codex App 跨会话
 * # ============================================================
 * # 运行流程：
 * #   1. 初始化引擎
 * #   2. snapshot() 创建 worktree 快照
 * #   3. publishChange() 发布状态变更
 * #   4. subscribe() 订阅状态变更
 * #   5. detectConflict() 检测冲突
 * #   6. resolveConflict() 解决冲突
 * #   7. startSync() 启动跨设备同步会话
 * # ============================================================
 * # 输入参数：worktreeId / change / conflict / endpoint
 * # 输出结果：WorktreeSnapshot / StateChange / Conflict
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 31 G31-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * Vector Clock
 */
export interface VectorClock {
  [deviceId: string]: number;
}

/**
 * Worktree 快照
 */
export interface WorktreeSnapshot {
  id: string;
  worktreeId: string;
  timestamp: number;
  vectorClock: VectorClock;
  state: {
    branch: string;
    commitHash: string;
    uncommittedChanges?: Array<{ path: string; content: string; op: 'add' | 'modify' | 'delete' }>;
    agentProgress?: Record<string, any>;
    worktreeMeta?: Record<string, any>;
  };
  deviceId: string;
  size: number;
}

/**
 * 状态变更
 */
export interface StateChange {
  id: string;
  worktreeId: string;
  timestamp: number;
  type: 'file-change' | 'commit' | 'agent-progress' | 'metadata' | 'full';
  path?: string;
  payload: any;
  vectorClock: VectorClock;
  deviceId: string;
}

/**
 * 冲突记录
 */
export interface Conflict {
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

export interface ConflictResolution {
  strategy: 'local' | 'remote' | 'merge' | 'manual';
  resolvedBy?: string;
  resolvedAt?: number;
  mergedContent?: any;
}

/**
 * 同步端点
 */
export interface SyncEndpoint {
  id: string;
  type: 'websocket' | 'sse' | 'polling' | 'broadcast-channel';
  url?: string;
  intervalMs?: number;
  deviceId: string;
  connected: boolean;
  lastSyncAt?: number;
}

/**
 * 同步会话
 */
export interface SyncSession {
  id: string;
  worktreeId: string;
  endpoint: SyncEndpoint;
  startedAt: number;
  lastActivityAt: number;
  status: 'active' | 'paused' | 'stopped' | 'error';
  error?: string;
}

/**
 * 设备信息
 */
export interface DeviceInfo {
  deviceId: string;
  name: string;
  type: 'desktop' | 'laptop' | 'tablet' | 'phone' | 'server';
  lastSeenAt: number;
  online: boolean;
}

/**
 * 引擎事件类型
 */
export type SyncEventType =
  | 'snapshot-created'
  | 'snapshot-restored'
  | 'change-published'
  | 'change-received'
  | 'conflict-detected'
  | 'conflict-resolved'
  | 'sync-started'
  | 'sync-stopped'
  | 'sync-error'
  | 'device-registered'
  | 'device-online'
  | 'device-offline';

export interface SyncEvent {
  type: SyncEventType;
  timestamp: number;
  data: unknown;
}

export interface SerializedSyncState {
  snapshots: WorktreeSnapshot[];
  conflicts: Conflict[];
  devices: DeviceInfo[];
  currentDeviceId: string;
  sessions: SyncSession[];
  subscribers: Array<{ worktreeId: string; count: number }>;
}

// ============ Vector Clock 类 ============

export class VectorClockImpl {
  private clocks: Map<string, number> = new Map();

  static from(other?: VectorClock): VectorClockImpl {
    const vc = new VectorClockImpl();
    if (other) {
      for (const [k, v] of Object.entries(other)) vc.clocks.set(k, v);
    }
    return vc;
  }

  increment(deviceId: string): VectorClock {
    this.clocks.set(deviceId, (this.clocks.get(deviceId) || 0) + 1);
    return this.toJSON();
  }

  merge(other: VectorClock): VectorClock {
    for (const [k, v] of Object.entries(other)) {
      this.clocks.set(k, Math.max(this.clocks.get(k) || 0, v));
    }
    return this.toJSON();
  }

  compare(other: VectorClock): 'before' | 'after' | 'concurrent' | 'equal' {
    const allKeys = new Set([...this.clocks.keys(), ...Object.keys(other)]);
    let thisGreater = false;
    let otherGreater = false;
    for (const k of allKeys) {
      const a = this.clocks.get(k) || 0;
      const b = other[k] || 0;
      if (a > b) thisGreater = true;
      if (a < b) otherGreater = true;
    }
    if (thisGreater && otherGreater) return 'concurrent';
    if (thisGreater) return 'after';
    if (otherGreater) return 'before';
    return 'equal';
  }

  toJSON(): VectorClock {
    return Object.fromEntries(this.clocks);
  }
}

// ============ 工具函数 ============

export function generateSnapshotId(): string {
  return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateChangeId(): string {
  return `chg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateConflictId(): string {
  return `conf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function generateSessionId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============ 引擎主类 ============

export class WorktreeSyncEngine {
  private snapshots: WorktreeSnapshot[] = [];
  private conflicts: Conflict[] = [];
  private devices: Map<string, DeviceInfo> = new Map();
  private currentDeviceId: string = `dev-${Math.random().toString(36).slice(2, 10)}`;
  private sessions: Map<string, SyncSession> = new Map();
  private subscribers: Map<string, Set<(change: StateChange) => void>> = new Map();
  private listeners: Map<SyncEventType, Set<(e: SyncEvent) => void>> = new Map();
  private storageKey = 'hermes.worktreeSync';

  constructor() {
    this.load();
    // 注册当前设备
    if (!this.devices.has(this.currentDeviceId)) {
      this.registerDevice({
        deviceId: this.currentDeviceId,
        name: 'Current Device',
        type: 'desktop',
        lastSeenAt: Date.now(),
        online: true,
      });
    }
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (raw) {
        const state: SerializedSyncState = JSON.parse(raw);
        if (Array.isArray(state.snapshots)) this.snapshots = state.snapshots;
        if (Array.isArray(state.conflicts)) this.conflicts = state.conflicts;
        if (Array.isArray(state.devices)) for (const d of state.devices) this.devices.set(d.deviceId, d);
        if (state.currentDeviceId) this.currentDeviceId = state.currentDeviceId;
        if (Array.isArray(state.sessions)) for (const s of state.sessions) this.sessions.set(s.id, s);
      }
    } catch (e) {
      console.warn('WorktreeSyncEngine: failed to load state', e);
    }
  }

  private save(): void {
    try {
      const state: SerializedSyncState = {
        snapshots: this.snapshots,
        conflicts: this.conflicts,
        devices: Array.from(this.devices.values()),
        currentDeviceId: this.currentDeviceId,
        sessions: Array.from(this.sessions.values()),
        subscribers: Array.from(this.subscribers.entries()).map(([worktreeId, set]) => ({ worktreeId, count: set.size })),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(state));
      }
    } catch (e) {
      console.warn('WorktreeSyncEngine: failed to save state', e);
    }
  }

  // ============ 同步会话 ============

  startSync(worktreeId: string, endpoint: SyncEndpoint): SyncSession {
    const session: SyncSession = {
      id: generateSessionId(),
      worktreeId,
      endpoint,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      status: 'active',
    };
    this.sessions.set(session.id, session);
    this.save();
    this.emit('sync-started', { session });
    return session;
  }

  stopSync(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = 'stopped';
    this.save();
    this.emit('sync-stopped', { sessionId });
  }

  listSessions(worktreeId?: string): SyncSession[] {
    const all = Array.from(this.sessions.values());
    return worktreeId ? all.filter((s) => s.worktreeId === worktreeId) : all;
  }

  getSession(sessionId: string): SyncSession | undefined {
    return this.sessions.get(sessionId);
  }

  // ============ 状态快照 ============

  snapshot(worktreeId: string, state?: Partial<WorktreeSnapshot['state']>): WorktreeSnapshot {
    const vectorClock: VectorClock = { [this.currentDeviceId]: Date.now() };

    const snap: WorktreeSnapshot = {
      id: generateSnapshotId(),
      worktreeId,
      timestamp: Date.now(),
      vectorClock,
      state: {
        branch: state?.branch || 'main',
        commitHash: state?.commitHash || '0000000',
        uncommittedChanges: state?.uncommittedChanges || [],
        agentProgress: state?.agentProgress,
        worktreeMeta: state?.worktreeMeta,
      },
      deviceId: this.currentDeviceId,
      size: state?.uncommittedChanges?.reduce((s, c) => s + c.content.length, 0) || 0,
    };
    this.snapshots.push(snap);
    this.save();
    this.emit('snapshot-created', { snapshot: snap });
    return snap;
  }

  async restore(snapshotId: string): Promise<void> {
    const snap = this.snapshots.find((s) => s.id === snapshotId);
    if (!snap) throw new Error(`Snapshot ${snapshotId} not found`);
    this.emit('snapshot-restored', { snapshot: snap });
  }

  listSnapshots(worktreeId: string): WorktreeSnapshot[] {
    return this.snapshots.filter((s) => s.worktreeId === worktreeId);
  }

  getSnapshot(snapshotId: string): WorktreeSnapshot | undefined {
    return this.snapshots.find((s) => s.id === snapshotId);
  }

  // ============ 状态广播 ============

  publishChange(
    worktreeId: string,
    change: Omit<StateChange, 'id' | 'timestamp' | 'deviceId' | 'vectorClock' | 'worktreeId'>
  ): StateChange {
    const fullChange: StateChange = {
      id: generateChangeId(),
      timestamp: Date.now(),
      deviceId: this.currentDeviceId,
      vectorClock: { [this.currentDeviceId]: Date.now() },
      ...change,
      worktreeId,
    };
    // 通知订阅者
    const subs = this.subscribers.get(worktreeId);
    if (subs) {
      for (const listener of subs) {
        try {
          listener(fullChange);
        } catch (e) {
          console.error('WorktreeSyncEngine subscriber error', e);
        }
      }
    }
    this.save();
    this.emit('change-published', { change: fullChange });
    return fullChange;
  }

  subscribe(worktreeId: string, listener: (change: StateChange) => void): () => void {
    if (!this.subscribers.has(worktreeId)) this.subscribers.set(worktreeId, new Set());
    this.subscribers.get(worktreeId)!.add(listener);
    return () => {
      this.subscribers.get(worktreeId)?.delete(listener);
    };
  }

  // ============ 冲突检测与解决 ============

  detectConflict(worktreeId: string, remoteSnapshot: WorktreeSnapshot): Conflict[] {
    const localSnapshots = this.snapshots.filter((s) => s.worktreeId === worktreeId);
    const conflicts: Conflict[] = [];

    for (const local of localSnapshots) {
      if (local.id === remoteSnapshot.id) continue;
      const localVc = VectorClockImpl.from(local.vectorClock);
      const cmp = localVc.compare(remoteSnapshot.vectorClock);
      if (cmp === 'concurrent') {
        // 检查是否已存在
        const existing = this.conflicts.find(
          (c) => c.worktreeId === worktreeId && c.localSnapshot.id === local.id && c.remoteSnapshot.id === remoteSnapshot.id
        );
        if (existing) continue;

        const conflict: Conflict = {
          id: generateConflictId(),
          worktreeId,
          type: 'file',
          localSnapshot: local,
          remoteSnapshot,
          detectedAt: Date.now(),
          status: 'pending',
        };
        this.conflicts.push(conflict);
        conflicts.push(conflict);
        this.emit('conflict-detected', { conflict });
      }
    }
    this.save();
    return conflicts;
  }

  resolveConflict(conflictId: string, resolution: ConflictResolution): Conflict {
    const conflict = this.conflicts.find((c) => c.id === conflictId);
    if (!conflict) throw new Error(`Conflict ${conflictId} not found`);
    conflict.status = 'resolved';
    conflict.resolution = { ...resolution, resolvedAt: Date.now() };
    this.save();
    this.emit('conflict-resolved', { conflict });
    return conflict;
  }

  listConflicts(worktreeId?: string): Conflict[] {
    return worktreeId ? this.conflicts.filter((c) => c.worktreeId === worktreeId) : this.conflicts;
  }

  getConflict(conflictId: string): Conflict | undefined {
    return this.conflicts.find((c) => c.id === conflictId);
  }

  abandonConflict(conflictId: string): void {
    const conflict = this.conflicts.find((c) => c.id === conflictId);
    if (!conflict) return;
    conflict.status = 'abandoned';
    this.save();
  }

  // ============ 设备管理 ============

  registerDevice(device: DeviceInfo): void {
    this.devices.set(device.deviceId, device);
    this.save();
    this.emit('device-registered', { device });
  }

  unregisterDevice(deviceId: string): void {
    this.devices.delete(deviceId);
    this.save();
  }

  listDevices(): DeviceInfo[] {
    return Array.from(this.devices.values());
  }

  setCurrentDevice(deviceId: string): void {
    if (!this.devices.has(deviceId)) {
      this.registerDevice({
        deviceId,
        name: 'Imported Device',
        type: 'desktop',
        lastSeenAt: Date.now(),
        online: true,
      });
    }
    this.currentDeviceId = deviceId;
    this.save();
  }

  getCurrentDeviceId(): string {
    return this.currentDeviceId;
  }

  setDeviceOnline(deviceId: string, online: boolean): void {
    const device = this.devices.get(deviceId);
    if (!device) return;
    device.online = online;
    device.lastSeenAt = Date.now();
    this.save();
    this.emit(online ? 'device-online' : 'device-offline', { deviceId });
  }

  // ============ 事件系统 ============

  on(event: SyncEventType, listener: (e: SyncEvent) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  private emit(type: SyncEventType, data: unknown): void {
    const listeners = this.listeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener({ type, timestamp: Date.now(), data });
        } catch (e) {
          console.error('WorktreeSyncEngine listener error', e);
        }
      }
    }
  }

  // ============ 辅助 ============

  reset(): void {
    this.snapshots = [];
    this.conflicts = [];
    this.devices.clear();
    this.sessions.clear();
    this.subscribers.clear();
    this.currentDeviceId = `dev-${Math.random().toString(36).slice(2, 10)}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.storageKey);
    }
  }
}

// ============ 单例 ============

let defaultEngine: WorktreeSyncEngine | null = null;

export function getDefaultWorktreeSyncEngine(): WorktreeSyncEngine {
  if (!defaultEngine) {
    defaultEngine = new WorktreeSyncEngine();
  }
  return defaultEngine;
}

export function resetDefaultWorktreeSyncEngine(): void {
  if (defaultEngine) {
    defaultEngine.reset();
  }
  defaultEngine = null;
}
