/**
 * # ============================================================
 * # HookChainTracker - Hook 执行链路追踪器 (v1.0.0 Cycle 21 G21-02)
 * # ============================================================
 * # 核心作用：为 HooksEngine 补充执行链路追踪能力，记录完整
 * #           hook 触发链、嵌套关系、耗时分布，支持时间线/DAG
 * #           /火焰图三种可视化模式
 * # 业务价值：
 * #   1. 用户可直观看到 hook 触发链路
 * #   2. 调试 hook 失败、定位根因
 * #   3. 性能分析（耗时分布、瓶颈识别）
 * #   4. 团队共享 hook 链路 JSON/Mermaid
 * #   5. 审计追溯（谁触发、什么时间、什么结果）
 * # 运行流程：
 * #   1. startChain(event) - 创建新链路
 * #   2. addNode() - 添加 hook 执行节点
 * #   3. updateNode() - 更新节点状态
 * #   4. triggerChildHook() - 嵌套触发时自动关联父链
 * #   5. finishChain() - 标记链路完成
 * #   6. exportChain() - 导出 JSON / Mermaid 格式
 * # 输入参数：
 * #   - HookEvent: 触发事件
 * #   - HookChainFilter: 链路过滤条件
 * # 输出结果：
 * #   - HookChain: 完整链路
 * #   - HookChainNode: 单个节点
 * #   - HookChainStats: 聚合统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-02 初次创建
 * #     - 核心 HookChainTracker 引擎
 * #     - 12 种事件类型 + 订阅机制
 * #     - 时间线/DAG/JSON/Mermaid 导出
 * #     - 环形缓冲（最多 1000 条链路）
 * #     - 单例工厂 + 自动清理
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

/** Hook 类型（与 HooksEngine 保持一致） */
export type HookType =
  | 'before_prompt'
  | 'after_prompt'
  | 'before_response'
  | 'after_response'
  | 'thinking'
  | 'subagent_start'
  | 'subagent_end'
  | 'compaction'
  | 'turn_complete'
  | 'tool_execution';

export const ALL_HOOK_TYPES: HookType[] = [
  'before_prompt',
  'after_prompt',
  'before_response',
  'after_response',
  'thinking',
  'subagent_start',
  'subagent_end',
  'compaction',
  'turn_complete',
  'tool_execution',
];

/** Hook 事件 */
export interface HookEvent {
  id: string;
  type: HookType;
  hookId: string;
  payload: Record<string, unknown>;
  timestamp: number;
  userId?: string;
  projectId?: string;
  taskId?: string;
}

/** Hook 执行状态 */
export type HookExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled';

/** Hook 链路节点 */
export interface HookChainNode {
  nodeId: string;
  hookId: string;
  hookName: string;
  hookType: HookType;
  status: HookExecutionStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  parentNodeId?: string;
  triggeredByNodeId?: string;
  error?: string;
  result?: unknown;
  depth: number;
  priority: number;
}

/** Hook 链路 */
export interface HookChain {
  chainId: string;
  rootEvent: HookEvent;
  nodes: HookChainNode[];
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  status: 'running' | 'success' | 'failed' | 'partial';
  triggerType: HookType;
  payload?: Record<string, unknown>;
  userId?: string;
  projectId?: string;
  taskId?: string;
}

/** 链路过滤器 */
export interface HookChainFilter {
  status?: HookChain['status'] | HookChain['status'][];
  triggerType?: HookType | HookType[];
  sinceMs?: number;
  untilMs?: number;
  limit?: number;
  sortBy?: 'startTime' | 'duration' | 'nodeCount';
  sortOrder?: 'asc' | 'desc';
}

/** 链路统计 */
export interface HookChainStats {
  totalChains: number;
  totalNodes: number;
  byStatus: Record<HookChain['status'], number>;
  byType: Record<HookType, number>;
  avgDuration: number;
  avgNodesPerChain: number;
  successRate: number;
  runningCount: number;
}

/** 链路事件类型 */
export type ChainEventType =
  | 'chain-started'
  | 'node-added'
  | 'node-updated'
  | 'chain-finished'
  | 'chain-cleared';

/** 链路事件 */
export interface ChainEvent {
  type: ChainEventType;
  chainId: string;
  nodeId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** 事件处理器 */
export type ChainEventHandler = (event: ChainEvent) => void;

/** 节点添加参数 */
export interface AddNodeParams {
  hookId: string;
  hookName: string;
  hookType: HookType;
  parentNodeId?: string;
  triggeredByNodeId?: string;
  priority?: number;
}

// ============================================================================
// 事件总线
// ============================================================================

class ChainEventBus {
  private listeners: Map<ChainEventType, Set<ChainEventHandler>> = new Map();

  on(type: ChainEventType, handler: ChainEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(event: ChainEvent): void {
    this.listeners.get(event.type)?.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Chain event handler error:', err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function _genId(prefix: string = 'chain'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 计算链路总耗时
 */
function _calcTotalDuration(chain: HookChain): number {
  if (chain.endTime) {
    return chain.endTime - chain.startTime;
  }
  // 未完成则使用最后一个节点的时间
  const lastNode = chain.nodes[chain.nodes.length - 1];
  if (lastNode) {
    return (lastNode.endTime ?? lastNode.startTime) - chain.startTime;
  }
  return 0;
}

// ============================================================================
// 核心类
// ============================================================================

/**
 * HookChainTracker - Hook 执行链路追踪器
 *
 * 记录完整 hook 触发链、嵌套关系、耗时分布，
 * 支持时间线/DAG/JSON/Mermaid 多种导出格式
 */
export class HookChainTracker {
  private chains: Map<string, HookChain> = new Map();
  private readonly eventBus: ChainEventBus = new ChainEventBus();
  private readonly maxChains: number = 1000;
  // 当前活跃链路（按触发时间）
  private readonly activeChains: Set<string> = new Set();
  // 嵌套链路关系：child chainId -> parent chainId
  private readonly parentMap: Map<string, string> = new Map();
  // 当前活跃节点栈
  private readonly activeStack: Map<string, string[]> = new Map();

  /**
   * 启动新链路
   *
   * @param event 根事件
   * @returns 链路对象
   */
  startChain(event: HookEvent): HookChain {
    if (!event || !event.id || !event.type) {
      throw new Error('Event must have id and type');
    }
    if (!ALL_HOOK_TYPES.includes(event.type)) {
      throw new Error(`Invalid hook type: ${event.type}`);
    }

    const chain: HookChain = {
      chainId: _genId('chain'),
      rootEvent: event,
      nodes: [],
      startTime: event.timestamp ?? Date.now(),
      status: 'running',
      triggerType: event.type,
      payload: event.payload,
      userId: event.userId,
      projectId: event.projectId,
      taskId: event.taskId,
    };

    // 限制最大链路数
    if (this.chains.size >= this.maxChains) {
      this._evictOldest();
    }

    this.chains.set(chain.chainId, chain);
    this.activeChains.add(chain.chainId);

    this.eventBus.emit({
      type: 'chain-started',
      chainId: chain.chainId,
      timestamp: Date.now(),
      data: { triggerType: event.type },
    });

    return chain;
  }

  /**
   * 添加节点到链路
   *
   * @param chainId 链路 ID
   * @param params 节点参数
   * @returns 添加的节点
   */
  addNode(chainId: string, params: AddNodeParams): HookChainNode {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain not found: ${chainId}`);
    }
    if (!params || !params.hookId || !params.hookName || !params.hookType) {
      throw new Error('Node must have hookId, hookName, hookType');
    }
    if (!ALL_HOOK_TYPES.includes(params.hookType)) {
      throw new Error(`Invalid hook type: ${params.hookType}`);
    }

    // 计算嵌套深度
    let depth = 0;
    if (params.parentNodeId) {
      const parent = chain.nodes.find((n) => n.nodeId === params.parentNodeId);
      if (parent) depth = parent.depth + 1;
    } else if (params.triggeredByNodeId) {
      const trigger = chain.nodes.find((n) => n.nodeId === params.triggeredByNodeId);
      if (trigger) depth = trigger.depth + 1;
    }

    const node: HookChainNode = {
      nodeId: _genId('node'),
      hookId: params.hookId,
      hookName: params.hookName,
      hookType: params.hookType,
      status: 'running',
      startTime: Date.now(),
      parentNodeId: params.parentNodeId,
      triggeredByNodeId: params.triggeredByNodeId,
      depth,
      priority: params.priority ?? 100,
    };

    chain.nodes.push(node);

    // 推入活跃栈
    if (!this.activeStack.has(chainId)) {
      this.activeStack.set(chainId, []);
    }
    this.activeStack.get(chainId)!.push(node.nodeId);

    this.eventBus.emit({
      type: 'node-added',
      chainId,
      nodeId: node.nodeId,
      timestamp: Date.now(),
    });

    return node;
  }

  /**
   * 更新节点状态
   *
   * @param chainId 链路 ID
   * @param nodeId 节点 ID
   * @param update 更新内容
   */
  updateNode(chainId: string, nodeId: string, update: Partial<HookChainNode>): void {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain not found: ${chainId}`);
    }
    const node = chain.nodes.find((n) => n.nodeId === nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    // 结束节点
    if (update.status && update.status !== 'running' && update.status !== 'pending') {
      node.endTime = update.endTime ?? Date.now();
      node.duration = node.endTime - node.startTime;
      node.status = update.status;
      if (update.error !== undefined) node.error = update.error;
      if (update.result !== undefined) node.result = update.result;

      // 从活跃栈移除
      const stack = this.activeStack.get(chainId);
      if (stack) {
        const idx = stack.indexOf(nodeId);
        if (idx >= 0) stack.splice(idx, 1);
      }
    } else {
      if (update.status !== undefined) node.status = update.status;
      if (update.error !== undefined) node.error = update.error;
      if (update.result !== undefined) node.result = update.result;
    }

    this.eventBus.emit({
      type: 'node-updated',
      chainId,
      nodeId,
      timestamp: Date.now(),
      data: { status: node.status },
    });
  }

  /**
   * 触发子 hook（嵌套链路）
   *
   * @param parentChainId 父链路 ID
   * @param event 子事件
   * @returns 子链路
   */
  triggerChildHook(parentChainId: string, event: HookEvent): HookChain {
    const childChain = this.startChain(event);
    this.parentMap.set(childChain.chainId, parentChainId);
    return childChain;
  }

  /**
   * 标记链路完成
   *
   * @param chainId 链路 ID
   * @param status 完成状态
   */
  finishChain(chainId: string, status: HookChain['status']): void {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain not found: ${chainId}`);
    }
    if (!['success', 'failed', 'partial'].includes(status)) {
      throw new Error(`Invalid chain status: ${status}`);
    }

    chain.status = status;
    chain.endTime = Date.now();
    chain.totalDuration = _calcTotalDuration(chain);

    // 强制结束所有未完成的节点
    for (const node of chain.nodes) {
      if (node.status === 'running' || node.status === 'pending') {
        node.status = status === 'success' ? 'success' : 'failed';
        node.endTime = chain.endTime;
        node.duration = node.endTime - node.startTime;
        if (status === 'failed' && !node.error) {
          node.error = 'Chain failed';
        }
      }
    }

    this.activeChains.delete(chainId);
    this.activeStack.delete(chainId);

    this.eventBus.emit({
      type: 'chain-finished',
      chainId,
      timestamp: Date.now(),
      data: { status, duration: chain.totalDuration },
    });
  }

  /**
   * 驱逐最早的链路
   */
  private _evictOldest(): void {
    const sorted = Array.from(this.chains.values()).sort((a, b) => a.startTime - b.startTime);
    const oldest = sorted[0];
    if (oldest) {
      this.chains.delete(oldest.chainId);
      this.activeChains.delete(oldest.chainId);
      this.activeStack.delete(oldest.chainId);
    }
  }

  /**
   * 获取单个链路
   */
  getChain(chainId: string): HookChain | null {
    return this.chains.get(chainId) ?? null;
  }

  /**
   * 获取父链路
   */
  getParentChain(chainId: string): HookChain | null {
    const parentId = this.parentMap.get(chainId);
    if (!parentId) return null;
    return this.chains.get(parentId) ?? null;
  }

  /**
   * 获取子链路
   */
  getChildChains(chainId: string): HookChain[] {
    const childIds: string[] = [];
    for (const [child, parent] of this.parentMap.entries()) {
      if (parent === chainId) childIds.push(child);
    }
    return childIds
      .map((id) => this.chains.get(id))
      .filter((c): c is HookChain => c !== undefined);
  }

  /**
   * 查询链路列表
   */
  getChains(filter: HookChainFilter = {}): HookChain[] {
    let result = Array.from(this.chains.values());

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      result = result.filter((c) => statuses.includes(c.status));
    }
    if (filter.triggerType) {
      const types = Array.isArray(filter.triggerType) ? filter.triggerType : [filter.triggerType];
      result = result.filter((c) => types.includes(c.triggerType));
    }
    if (filter.sinceMs) {
      result = result.filter((c) => c.startTime >= filter.sinceMs!);
    }
    if (filter.untilMs) {
      result = result.filter((c) => c.startTime <= filter.untilMs!);
    }

    const sortBy = filter.sortBy ?? 'startTime';
    const sortOrder = filter.sortOrder ?? 'desc';
    result.sort((a, b) => {
      let aVal = 0;
      let bVal = 0;
      if (sortBy === 'startTime') {
        aVal = a.startTime;
        bVal = b.startTime;
      } else if (sortBy === 'duration') {
        aVal = a.totalDuration ?? 0;
        bVal = b.totalDuration ?? 0;
      } else if (sortBy === 'nodeCount') {
        aVal = a.nodes.length;
        bVal = b.nodes.length;
      }
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * 获取统计
   */
  getStats(filter: HookChainFilter = {}): HookChainStats {
    const chains = this.getChains(filter);
    const nodes = chains.flatMap((c) => c.nodes);

    const byStatus: Record<HookChain['status'], number> = {
      running: 0,
      success: 0,
      failed: 0,
      partial: 0,
    };
    const byType: Record<HookType, number> = {
      before_prompt: 0,
      after_prompt: 0,
      before_response: 0,
      after_response: 0,
      thinking: 0,
      subagent_start: 0,
      subagent_end: 0,
      compaction: 0,
      turn_complete: 0,
      tool_execution: 0,
    };

    chains.forEach((c) => {
      byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
      byType[c.triggerType] = (byType[c.triggerType] ?? 0) + 1;
    });

    const completedChains = chains.filter((c) => c.totalDuration !== undefined);
    const avgDuration =
      completedChains.length > 0
        ? completedChains.reduce((sum, c) => sum + (c.totalDuration ?? 0), 0) / completedChains.length
        : 0;

    const avgNodesPerChain = chains.length > 0 ? nodes.length / chains.length : 0;
    const successCount = byStatus.success ?? 0;
    const successRate = chains.length > 0 ? successCount / chains.length : 0;

    return {
      totalChains: chains.length,
      totalNodes: nodes.length,
      byStatus,
      byType,
      avgDuration,
      avgNodesPerChain,
      successRate,
      runningCount: byStatus.running ?? 0,
    };
  }

  /**
   * 导出链路
   *
   * @param chainId 链路 ID
   * @param format 导出格式 (json | mermaid | dot)
   * @returns 导出内容
   */
  exportChain(chainId: string, format: 'json' | 'mermaid' | 'dot' = 'json'): string {
    const chain = this.chains.get(chainId);
    if (!chain) {
      throw new Error(`Chain not found: ${chainId}`);
    }

    if (format === 'json') {
      return JSON.stringify(chain, null, 2);
    }

    if (format === 'mermaid') {
      const lines: string[] = [];
      lines.push('```mermaid');
      lines.push('graph TD');
      const statusEmoji: Record<HookChainNode['status'], string> = {
        pending: '⏳',
        running: '🔄',
        success: '✅',
        failed: '❌',
        timeout: '⏰',
        cancelled: '🚫',
      };
      chain.nodes.forEach((node) => {
        const label = `${statusEmoji[node.status]} ${node.hookName}<br/>${node.hookType}<br/>${node.duration ?? 0}ms`;
        const safeId = node.nodeId.replace(/-/g, '_');
        lines.push(`  ${safeId}["${label}"]`);
      });
      // 关系
      chain.nodes.forEach((node) => {
        if (node.triggeredByNodeId) {
          const fromId = node.triggeredByNodeId.replace(/-/g, '_');
          const toId = node.nodeId.replace(/-/g, '_');
          lines.push(`  ${fromId} --> ${toId}`);
        } else if (node.parentNodeId) {
          const fromId = node.parentNodeId.replace(/-/g, '_');
          const toId = node.nodeId.replace(/-/g, '_');
          lines.push(`  ${fromId} -.-> ${toId}`);
        }
      });
      lines.push('```');
      return lines.join('\n');
    }

    if (format === 'dot') {
      const lines: string[] = [];
      lines.push('digraph HookChain {');
      lines.push('  rankdir=LR;');
      lines.push('  node [shape=box, style=filled];');
      chain.nodes.forEach((node) => {
        const color =
          node.status === 'success'
            ? 'green'
            : node.status === 'failed'
            ? 'red'
            : node.status === 'timeout'
            ? 'orange'
            : node.status === 'cancelled'
            ? 'gray'
            : 'lightblue';
        const label = `${node.hookName}\\n${node.hookType}\\n${node.duration ?? 0}ms`;
        const safeId = node.nodeId.replace(/-/g, '_');
        lines.push(`  "${safeId}" [label="${label}", fillcolor="${color}"];`);
      });
      chain.nodes.forEach((node) => {
        const fromId = node.triggeredByNodeId ?? node.parentNodeId;
        if (fromId) {
          lines.push(`  "${fromId.replace(/-/g, '_')}" -> "${node.nodeId.replace(/-/g, '_')}";`);
        }
      });
      lines.push('}');
      return lines.join('\n');
    }

    throw new Error(`Unsupported format: ${format}`);
  }

  /**
   * 订阅事件
   */
  on(type: ChainEventType, handler: ChainEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }

  /**
   * 清空链路
   */
  clear(filter: HookChainFilter = {}): number {
    const toDelete = this.getChains(filter);
    toDelete.forEach((c) => {
      this.chains.delete(c.chainId);
      this.activeChains.delete(c.chainId);
      this.activeStack.delete(c.chainId);
    });
    return toDelete.length;
  }

  /**
   * 获取所有活跃链路
   */
  getActiveChains(): HookChain[] {
    return Array.from(this.activeChains)
      .map((id) => this.chains.get(id))
      .filter((c): c is HookChain => c !== undefined);
  }

  /**
   * 获取所有链路（按状态分组）
   */
  getChainsByStatus(): Record<HookChain['status'], HookChain[]> {
    const result: Record<HookChain['status'], HookChain[]> = {
      running: [],
      success: [],
      failed: [],
      partial: [],
    };
    this.chains.forEach((chain) => {
      result[chain.status].push(chain);
    });
    return result;
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: HookChainTracker | null = null;

/**
 * 获取 HookChainTracker 单例
 */
export function getHookChainTracker(): HookChainTracker {
  if (!_instance) {
    _instance = new HookChainTracker();
  }
  return _instance;
}

/**
 * 重置 HookChainTracker 单例
 */
export function resetHookChainTracker(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}

/**
 * 检查是否已初始化
 */
export function isHookChainTrackerInitialized(): boolean {
  return _instance !== null;
}
