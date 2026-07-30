/**
 * # ============================================================
 * # Agent Checkpoint Engine - 代理检查点引擎 (v1.0.0 Cycle 27 G27-02)
 * # ============================================================
 * # 核心作用：保存和恢复整个代理树的状态
 * # 参考：Claude Code 2026-06 #7 Agent Checkpointing and Resume
 * # 运行流程：
 * #   1. saveCheckpoint(rootUuid) 序列化代理树
 * #   2. restoreCheckpoint(id) 重建代理树
 * #   3. listCheckpoints() / deleteCheckpoint() 管理检查点
 * #   4. 自动清理过期检查点
 * # 输入参数：saveCheckpoint(rootUuid, options), restoreCheckpoint(id)
 * # 输出结果：AgentCheckpoint / boolean
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-02 初次创建
 * # ============================================================
 */

import {
  AgentCheckpoint,
  AgentCheckpointConfig,
  AgentCheckpointEvent,
  AgentCheckpointEventType,
  DEFAULT_AGENT_CHECKPOINT_CONFIG,
  generateCheckpointId,
  calculateCheckpointSize,
} from './agentCheckpointTypes';

/**
 * 简化的节点结构（用于检查点序列化）
 */
interface CheckpointNode {
  uuid: string;
  path: string;
  parentUuid?: string;
  config: unknown;
  depth: number;
  status: string;
  children: string[];
  currentTask?: unknown;
  completedTasks: number;
  failedTasks: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  tokensUsed: number;
  contextUsage: number;
  error?: string;
  metadata: Record<string, unknown>;
}

/**
 * 序列化的树
 */
interface SerializedTreeData {
  version: string;
  rootUuid: string;
  nodes: CheckpointNode[];
  exportedAt: number;
}

/**
 * 抽象的代理引擎接口（避免循环依赖）
 * 实际使用 NestedSubAgentEngine 时会实现此接口
 */
export interface IAgentEngine {
  exportTree(rootUuid?: string): SerializedTreeData;
  importTree(data: SerializedTreeData): string;
  getAllNodes(): Array<{ uuid: string; tokensUsed: number; config: { name: string; role: string } }>;
  clear?(): void;
}

/**
 * 代理检查点引擎
 */
export class AgentCheckpointEngine {
  private config: AgentCheckpointConfig;
  private checkpoints: Map<string, AgentCheckpoint> = new Map();
  private listeners: Map<AgentCheckpointEventType, Set<(e: AgentCheckpointEvent) => void>> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<AgentCheckpointConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_CHECKPOINT_CONFIG, ...config };
    this.load();
    this.startAutoCleanup();
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.config.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.checkpoints)) {
        for (const cp of data.checkpoints) {
          this.checkpoints.set(cp.id, cp);
        }
      }
    } catch (e) {
      console.warn('AgentCheckpointEngine: failed to load', e);
    }
  }

  private save(): void {
    try {
      const data = {
        checkpoints: Array.from(this.checkpoints.values()),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.config.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        this.emit({ type: 'storage-quota-exceeded', timestamp: Date.now() });
        this.cleanupOldest(Math.max(1, Math.floor(this.config.maxCheckpoints / 2)));
      } else {
        console.warn('AgentCheckpointEngine: failed to save', e);
      }
    }
  }

  // ============ 事件系统 ============

  on(event: AgentCheckpointEventType, listener: (e: AgentCheckpointEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: AgentCheckpointEventType, listener: (e: AgentCheckpointEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: AgentCheckpointEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('AgentCheckpointEngine: error in event handler', err);
        }
      }
    }
  }

  // ============ 检查点管理 ============

  /**
   * 保存检查点
   */
  saveCheckpoint(
    engine: IAgentEngine,
    rootUuid: string,
    options: { name?: string; description?: string; tags?: string[] } = {}
  ): AgentCheckpoint {
    const treeData = engine.exportTree(rootUuid);
    const allNodes = engine.getAllNodes();
    const totalTokens = allNodes.reduce((sum, n) => sum + (n.tokensUsed || 0), 0);
    const id = generateCheckpointId();
    const checkpoint: AgentCheckpoint = {
      id,
      name: options.name || `checkpoint-${new Date().toLocaleString('zh-CN')}`,
      description: options.description || '',
      createdAt: Date.now(),
      rootUuid,
      sizeBytes: calculateCheckpointSize(treeData),
      nodeCount: treeData.nodes.length,
      totalTokens,
      tags: options.tags || [],
      treeData,
      metadata: {},
    };
    this.checkpoints.set(id, checkpoint);
    this.enforceMaxCheckpoints();
    this.save();
    this.emit({
      type: 'checkpoint-saved',
      timestamp: Date.now(),
      checkpointId: id,
      data: { name: checkpoint.name, nodeCount: checkpoint.nodeCount },
    });
    return checkpoint;
  }

  /**
   * 恢复检查点
   */
  restoreCheckpoint(engine: IAgentEngine, id: string): boolean {
    const cp = this.checkpoints.get(id);
    if (!cp) return false;
    try {
      engine.importTree(cp.treeData as SerializedTreeData);
      this.emit({
        type: 'checkpoint-restored',
        timestamp: Date.now(),
        checkpointId: id,
        data: { name: cp.name, rootUuid: cp.rootUuid },
      });
      return true;
    } catch (err) {
      console.error('AgentCheckpointEngine: failed to restore', err);
      return false;
    }
  }

  /**
   * 列出所有检查点
   */
  listCheckpoints(): AgentCheckpoint[] {
    return Array.from(this.checkpoints.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * 获取检查点
   */
  getCheckpoint(id: string): AgentCheckpoint | undefined {
    return this.checkpoints.get(id);
  }

  /**
   * 删除检查点
   */
  deleteCheckpoint(id: string): boolean {
    const ok = this.checkpoints.delete(id);
    if (ok) {
      this.save();
      this.emit({
        type: 'checkpoint-deleted',
        timestamp: Date.now(),
        checkpointId: id,
      });
    }
    return ok;
  }

  /**
   * 重命名检查点
   */
  renameCheckpoint(id: string, newName: string): boolean {
    const cp = this.checkpoints.get(id);
    if (!cp) return false;
    cp.name = newName;
    this.save();
    this.emit({
      type: 'checkpoint-renamed',
      timestamp: Date.now(),
      checkpointId: id,
      data: { newName },
    });
    return true;
  }

  /**
   * 添加标签
   */
  addTag(id: string, tag: string): boolean {
    const cp = this.checkpoints.get(id);
    if (!cp) return false;
    if (!cp.tags.includes(tag)) {
      cp.tags.push(tag);
      this.save();
    }
    return true;
  }

  /**
   * 强制执行最大检查点限制
   */
  private enforceMaxCheckpoints(): void {
    const all = this.listCheckpoints();
    if (all.length > this.config.maxCheckpoints) {
      const toDelete = all.slice(this.config.maxCheckpoints);
      for (const cp of toDelete) {
        this.checkpoints.delete(cp.id);
      }
    }
  }

  /**
   * 清理最旧的 N 个检查点
   */
  private cleanupOldest(count: number): void {
    const all = this.listCheckpoints();
    const toDelete = all.slice(-count);
    for (const cp of toDelete) {
      this.checkpoints.delete(cp.id);
    }
    this.save();
  }

  /**
   * 启动自动清理
   */
  private startAutoCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    // 每小时检查一次
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, 60 * 60 * 1000);
  }

  /**
   * 清理过期检查点
   */
  cleanupExpired(): number {
    const cutoff = Date.now() - this.config.cleanupDays * 24 * 60 * 60 * 1000;
    let removed = 0;
    for (const [id, cp] of this.checkpoints.entries()) {
      if (cp.createdAt < cutoff) {
        this.checkpoints.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.save();
      this.emit({
        type: 'cleanup-completed',
        timestamp: Date.now(),
        data: { removedCount: removed },
      });
    }
    return removed;
  }

  /**
   * 清空所有检查点
   */
  clear(): void {
    this.checkpoints.clear();
    this.save();
  }

  /**
   * 获取统计
   */
  getStats(): {
    total: number;
    totalSizeBytes: number;
    oldestAt: number | null;
    newestAt: number | null;
    averageSizeBytes: number;
  } {
    const all = this.listCheckpoints();
    if (all.length === 0) {
      return {
        total: 0,
        totalSizeBytes: 0,
        oldestAt: null,
        newestAt: null,
        averageSizeBytes: 0,
      };
    }
    const sizes = all.map((c) => c.sizeBytes);
    return {
      total: all.length,
      totalSizeBytes: sizes.reduce((a, b) => a + b, 0),
      oldestAt: all[all.length - 1].createdAt,
      newestAt: all[0].createdAt,
      averageSizeBytes: sizes.reduce((a, b) => a + b, 0) / sizes.length,
    };
  }

  /**
   * 销毁引擎
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// ============ 单例管理 ============

let defaultInstance: AgentCheckpointEngine | null = null;

export function getDefaultAgentCheckpointEngine(): AgentCheckpointEngine {
  if (!defaultInstance) {
    defaultInstance = new AgentCheckpointEngine();
  }
  return defaultInstance;
}

export function resetDefaultAgentCheckpointEngine(): void {
  if (defaultInstance) {
    defaultInstance.destroy();
  }
  defaultInstance = null;
}
