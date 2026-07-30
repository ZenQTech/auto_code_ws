/**
 * # ============================================================
 * # Nested Sub-Agent Engine - 嵌套子代理引擎核心实现 (v1.0.0 Cycle 27 G27-01)
 * # ============================================================
 * # 核心作用：实现 3 层嵌套子代理编排引擎
 * # 参考：Claude Code 2026-06 #1 Nested Sub-Agents + Codex v0.145 V2
 * # 运行流程：
 * #   1. createRootAgent 创建根节点
 * #   2. createChildAgent 递归创建子节点（深度限制 + 循环检测）
 * #   3. startAgent 启动节点（带超时控制 + context 跟踪）
 * #   4. pauseAgent / resumeAgent / cancelAgent 状态管理
 * #   5. exportTree / importTree 序列化与恢复
 * #   6. 事件总线实时通知订阅者
 * # 输入参数：createRootAgent(config) / createChildAgent(parent, config) / startAgent(uuid, task)
 * # 输出结果：UUID / SubAgentNode / SubAgentTree / Promise<void>
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-01 初次创建
 * # ============================================================
 */

import {
  SubAgentConfig,
  SubAgentNode,
  AgentTask,
  NestedSubAgentConfig,
  NestedSubAgentEvent,
  NestedSubAgentEventType,
  SubAgentTree,
  SerializedTree,
  NestedSubAgentStats,
  AgentRole,
  AgentStatus,
  DEFAULT_NESTED_SUB_AGENT_CONFIG,
  DEFAULT_CONTEXT_WINDOWS,
  generateNodeUuid,
  generateTaskId,
  parsePath,
  buildPath,
  estimateTokens,
  DepthLimitError,
  CycleError,
  NodeNotFoundError,
  TaskTimeoutError,
  InvalidConfigError,
} from './nestedSubAgentTypes';

// ============ 引擎类 ============

/**
 * 嵌套子代理引擎
 * 负责管理整个代理树的生命周期
 */
export class NestedSubAgentEngine {
  private config: NestedSubAgentConfig;
  private nodes: Map<string, SubAgentNode> = new Map();
  private listeners: Map<NestedSubAgentEventType, Set<(e: NestedSubAgentEvent) => void>> = new Map();
  private activeTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private storageKey = 'hermes.nestedSubAgent';
  private runningCount = 0;

  constructor(config: Partial<NestedSubAgentConfig> = {}) {
    this.config = { ...DEFAULT_NESTED_SUB_AGENT_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 持久化 ============

  /**
   * 从 localStorage 加载
   */
  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.nodes)) {
        for (const n of data.nodes) {
          // 恢复时重置运行中状态
          if (n.status === 'running') {
            n.status = 'paused';
          }
          this.nodes.set(n.uuid, n);
        }
      }
    } catch (e) {
      console.warn('NestedSubAgentEngine: failed to load from localStorage', e);
    }
  }

  /**
   * 保存到 localStorage
   */
  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        nodes: Array.from(this.nodes.values()),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('NestedSubAgentEngine: failed to save to localStorage', e);
    }
  }

  // ============ 事件系统 ============

  /**
   * 订阅事件
   * @returns 取消订阅函数
   */
  on(event: NestedSubAgentEventType, listener: (e: NestedSubAgentEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  /**
   * 取消订阅
   */
  off(event: NestedSubAgentEventType, listener: (e: NestedSubAgentEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  /**
   * 触发事件
   */
  private emit(event: NestedSubAgentEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error(`NestedSubAgentEngine: error in event handler for ${event.type}`, err);
        }
      }
    }
  }

  // ============ 创建代理 ============

  /**
   * 创建根代理
   * @returns 根节点 UUID
   */
  createRootAgent(config: Omit<SubAgentConfig, 'id'> & { id?: string }): string {
    if (config.name !== 'root' && !config.name) {
      throw new InvalidConfigError('Root agent name must be "root" or non-empty');
    }
    const rootName = config.name || 'root';
    if (rootName !== 'root') {
      // 用户自定义 root 名称
      if (!/^[a-z][a-z0-9-]*$/.test(rootName)) {
        throw new InvalidConfigError(`Invalid root agent name: ${rootName}`);
      }
    }
    const uuid = generateNodeUuid();
    const node: SubAgentNode = {
      uuid,
      path: rootName === 'root' ? '/root' : `/${rootName}`,
      config: { ...this.fillDefaultConfig(config), id: uuid },
      depth: 0,
      status: 'idle',
      children: [],
      completedTasks: 0,
      failedTasks: 0,
      createdAt: Date.now(),
      tokensUsed: 0,
      contextUsage: 0,
      metadata: {},
    };
    this.nodes.set(uuid, node);
    this.save();
    this.emit({
      type: 'agent-created',
      timestamp: Date.now(),
      agentUuid: uuid,
      agentPath: node.path,
      data: { config: node.config },
    });
    return uuid;
  }

  /**
   * 创建子代理
   * @returns 子节点 UUID
   * @throws DepthLimitError
   * @throws CycleError
   * @throws NodeNotFoundError
   */
  createChildAgent(
    parentUuid: string,
    config: Omit<SubAgentConfig, 'id'> & { id?: string }
  ): string {
    const parent = this.nodes.get(parentUuid);
    if (!parent) {
      throw new NodeNotFoundError(`Parent agent not found: ${parentUuid}`);
    }
    // 深度检查（在抛错前触发事件）
    if (parent.depth + 1 >= this.config.maxDepth) {
      const attemptedPath = buildPath(parent.path, config.name);
      this.emit({
        type: 'depth-limit-reached',
        timestamp: Date.now(),
        agentUuid: parentUuid,
        agentPath: parent.path,
        data: { attemptedPath, maxDepth: this.config.maxDepth },
      });
      throw new DepthLimitError(
        `Cannot create child agent: max depth ${this.config.maxDepth} reached (parent at depth ${parent.depth})`
      );
    }
    // 循环检查：同父下不允许重名
    for (const childUuid of parent.children) {
      const child = this.nodes.get(childUuid);
      if (child && child.config.name === config.name) {
        const cycleErr = new CycleError(
          `Cycle detected: sibling agent with same name already exists: ${config.name}`
        );
        this.emit({
          type: 'cycle-detected',
          timestamp: Date.now(),
          agentUuid: parentUuid,
          agentPath: parent.path,
          data: { parentPath: parent.path, childName: config.name },
        });
        throw cycleErr;
      }
    }
    // 构造子节点
    const uuid = generateNodeUuid();
    const childPath = buildPath(parent.path, config.name);
    const node: SubAgentNode = {
      uuid,
      path: childPath,
      parentUuid,
      config: { ...this.fillDefaultConfig(config), id: uuid },
      depth: parent.depth + 1,
      status: 'idle',
      children: [],
      completedTasks: 0,
      failedTasks: 0,
      createdAt: Date.now(),
      tokensUsed: 0,
      contextUsage: 0,
      metadata: {},
    };
    this.nodes.set(uuid, node);
    parent.children.push(uuid);
    this.save();
    this.emit({
      type: 'agent-created',
      timestamp: Date.now(),
      agentUuid: uuid,
      agentPath: childPath,
      data: { config: node.config, parentUuid },
    });
    return uuid;
  }

  /**
   * 填充默认配置
   */
  private fillDefaultConfig(config: Partial<SubAgentConfig>): SubAgentConfig {
    const model = config.model || this.config.defaultModel;
    return {
      id: config.id,
      role: config.role || 'custom',
      name: config.name || 'unnamed',
      description: config.description || '',
      model,
      reasoningEffort: config.reasoningEffort || this.config.defaultReasoningEffort,
      systemPrompt: config.systemPrompt || '',
      tools: config.tools || [],
      constraints: config.constraints || [],
      contextWindow: config.contextWindow || DEFAULT_CONTEXT_WINDOWS[model] || 200000,
      timeoutMs: config.timeoutMs === undefined ? this.config.defaultTimeoutMs : config.timeoutMs,
    };
  }

  // ============ 生命周期 ============

  /**
   * 启动代理
   * 模拟任务执行（生产环境会调用 LLM）
   */
  async startAgent(
    uuid: string,
    task: Omit<AgentTask, 'id' | 'status' | 'tokensUsed'>
  ): Promise<void> {
    const node = this.nodes.get(uuid);
    if (!node) {
      throw new NodeNotFoundError(`Agent not found: ${uuid}`);
    }
    if (node.status === 'running') {
      return; // 已在运行
    }
    if (this.runningCount >= this.config.maxConcurrency) {
      throw new Error(`Concurrency limit reached: ${this.config.maxConcurrency}`);
    }

    // 构造任务
    const agentTask: AgentTask = {
      id: generateTaskId(),
      description: task.description,
      input: task.input,
      status: 'pending',
      tokensUsed: 0,
    };
    node.currentTask = agentTask;
    node.status = 'running';
    node.startedAt = Date.now();
    this.runningCount++;
    this.save();
    this.emit({
      type: 'agent-started',
      timestamp: Date.now(),
      agentUuid: uuid,
      agentPath: node.path,
      data: { task: agentTask },
    });

    // 模拟执行
    try {
      await this.executeTask(node, agentTask);
      node.status = 'completed';
      node.completedAt = Date.now();
      node.completedTasks++;
      this.runningCount--;
      this.save();
      this.emit({
        type: 'agent-completed',
        timestamp: Date.now(),
        agentUuid: uuid,
        agentPath: node.path,
        data: { output: agentTask.output, tokensUsed: agentTask.tokensUsed },
      });
    } catch (err) {
      this.runningCount--;
      const error = err instanceof Error ? err.message : String(err);
      if (err instanceof TaskTimeoutError) {
        node.status = 'timeout';
        node.completedAt = Date.now();
        this.save();
        this.emit({
          type: 'agent-timed-out',
          timestamp: Date.now(),
          agentUuid: uuid,
          agentPath: node.path,
          data: { error, timeoutMs: node.config.timeoutMs },
        });
      } else {
        node.status = 'failed';
        node.error = error;
        node.completedAt = Date.now();
        node.failedTasks++;
        this.save();
        this.emit({
          type: 'agent-failed',
          timestamp: Date.now(),
          agentUuid: uuid,
          agentPath: node.path,
          data: { error },
        });
      }
    } finally {
      // 清理超时定时器
      const timer = this.activeTimers.get(uuid);
      if (timer) {
        clearTimeout(timer);
        this.activeTimers.delete(uuid);
      }
    }
  }

  /**
   * 执行任务（带超时）
   */
  private executeTask(node: SubAgentNode, task: AgentTask): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 超时定时器
      if (node.config.timeoutMs > 0) {
        const timer = setTimeout(() => {
          this.activeTimers.delete(node.uuid);
          reject(new TaskTimeoutError(`Task timeout after ${node.config.timeoutMs}ms`));
        }, node.config.timeoutMs);
        this.activeTimers.set(node.uuid, timer);
      }
      // 模拟任务执行
      this.simulateTaskExecution(node, task)
        .then(() => {
          this.activeTimers.delete(node.uuid);
          resolve();
        })
        .catch((err) => {
          this.activeTimers.delete(node.uuid);
          reject(err);
        });
    });
  }

  /**
   * 模拟任务执行（生产环境会调用 LLM）
   * 这里使用 setTimeout + token 估算模拟
   */
  private simulateTaskExecution(node: SubAgentNode, task: AgentTask): Promise<void> {
    return new Promise<void>((resolve) => {
      const tokensForInput = estimateTokens(task.input || '');
      const tokensForOutput = estimateTokens(task.description || '') * 2;
      const totalTokens = tokensForInput + tokensForOutput;
      // 模拟 100-500ms 延迟
      const delay = 100 + Math.random() * 400;
      setTimeout(() => {
        task.status = 'completed';
        task.startedAt = task.startedAt || Date.now() - delay;
        task.completedAt = Date.now();
        task.output = `[${node.config.role}] 完成: ${task.description}`;
        task.tokensUsed = totalTokens;
        // 更新节点 context 使用
        node.tokensUsed += totalTokens;
        node.contextUsage = node.tokensUsed / node.config.contextWindow;
        // 检查 context 压缩阈值
        if (node.contextUsage >= this.config.contextCompactThreshold) {
          this.compactContext(node);
        }
        this.save();
        resolve();
      }, delay);
    });
  }

  /**
   * 压缩 context
   */
  private compactContext(node: SubAgentNode): void {
    const beforeTokens = node.tokensUsed;
    node.tokensUsed = Math.floor(node.tokensUsed * 0.6);
    node.contextUsage = node.tokensUsed / node.config.contextWindow;
    this.save();
    this.emit({
      type: 'context-compacted',
      timestamp: Date.now(),
      agentUuid: node.uuid,
      agentPath: node.path,
      data: { beforeTokens, afterTokens: node.tokensUsed },
    });
  }

  /**
   * 暂停代理
   */
  pauseAgent(uuid: string): void {
    const node = this.nodes.get(uuid);
    if (!node) return;
    if (node.status !== 'running') return;
    node.status = 'paused';
    // 清理定时器
    const timer = this.activeTimers.get(uuid);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(uuid);
    }
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.save();
    this.emit({
      type: 'agent-paused',
      timestamp: Date.now(),
      agentUuid: uuid,
      agentPath: node.path,
    });
  }

  /**
   * 恢复代理
   */
  async resumeAgent(uuid: string): Promise<void> {
    const node = this.nodes.get(uuid);
    if (!node) return;
    if (node.status !== 'paused') return;
    if (!node.currentTask) return;
    const task = { ...node.currentTask };
    await this.startAgent(uuid, {
      description: task.description,
      input: task.input,
    });
    this.emit({
      type: 'agent-resumed',
      timestamp: Date.now(),
      agentUuid: uuid,
      agentPath: node.path,
    });
  }

  /**
   * 取消代理及其所有子代理
   */
  cancelAgent(uuid: string): void {
    const node = this.nodes.get(uuid);
    if (!node) return;
    // 递归取消
    const stack = [uuid];
    const cancelled: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const n = this.nodes.get(current);
      if (!n) continue;
      const wasRunning = n.status === 'running';
      n.status = 'cancelled';
      n.completedAt = Date.now();
      // 清理定时器
      const timer = this.activeTimers.get(current);
      if (timer) {
        clearTimeout(timer);
        this.activeTimers.delete(current);
      }
      if (wasRunning) {
        this.runningCount = Math.max(0, this.runningCount - 1);
      }
      cancelled.push(current);
      stack.push(...n.children);
    }
    this.save();
    for (const id of cancelled) {
      const n = this.nodes.get(id);
      if (n) {
        this.emit({
          type: 'agent-cancelled',
          timestamp: Date.now(),
          agentUuid: id,
          agentPath: n.path,
        });
      }
    }
  }

  // ============ 查询 ============

  /**
   * 获取节点
   */
  getAgent(uuid: string): SubAgentNode | undefined {
    return this.nodes.get(uuid);
  }

  /**
   * 通过路径获取节点
   */
  getAgentByPath(path: string): SubAgentNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.path === path) return node;
    }
    return undefined;
  }

  /**
   * 获取子代理
   */
  getChildren(uuid: string): SubAgentNode[] {
    const node = this.nodes.get(uuid);
    if (!node) return [];
    return node.children
      .map((c) => this.nodes.get(c))
      .filter((n): n is SubAgentNode => Boolean(n));
  }

  /**
   * 获取兄弟代理
   */
  getSiblings(uuid: string): SubAgentNode[] {
    const node = this.nodes.get(uuid);
    if (!node) return [];
    if (!node.parentUuid) return []; // 根节点无兄弟
    const parent = this.nodes.get(node.parentUuid);
    if (!parent) return [];
    return parent.children
      .filter((c) => c !== uuid)
      .map((c) => this.nodes.get(c))
      .filter((n): n is SubAgentNode => Boolean(n));
  }

  /**
   * 获取所有根节点
   */
  getRoots(): SubAgentNode[] {
    const roots: SubAgentNode[] = [];
    for (const node of this.nodes.values()) {
      if (!node.parentUuid) roots.push(node);
    }
    return roots;
  }

  /**
   * 获取完整树
   */
  getTree(rootUuid?: string): SubAgentTree | undefined {
    if (rootUuid) {
      const root = this.nodes.get(rootUuid);
      if (!root) return undefined;
      return this.buildTree(root);
    }
    const roots = this.getRoots();
    if (roots.length === 0) return undefined;
    return this.buildTree(roots[0]);
  }

  /**
   * 构建树结构
   */
  private buildTree(root: SubAgentNode): SubAgentTree {
    let totalAgents = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalTokensUsed = 0;
    let maxDepthReached = 0;
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      totalAgents++;
      if (current.status === 'completed') totalCompleted++;
      if (current.status === 'failed') totalFailed++;
      totalTokensUsed += current.tokensUsed;
      if (current.depth > maxDepthReached) maxDepthReached = current.depth;
      stack.push(...current.children.map((c) => this.nodes.get(c)).filter(Boolean) as SubAgentNode[]);
    }
    return {
      rootUuid: root.uuid,
      totalAgents,
      totalCompleted,
      totalFailed,
      totalTokensUsed,
      maxDepthReached,
    };
  }

  /**
   * 解析路径
   */
  resolvePath(path: string): string | undefined {
    const node = this.getAgentByPath(path);
    return node?.uuid;
  }

  /**
   * 验证路径
   */
  validatePath(parentPath: string, childName: string): boolean {
    try {
      const segs = parsePath(parentPath);
      if (segs.length >= this.config.maxDepth) return false;
      if (!/^[a-z][a-z0-9-]*$/.test(childName)) return false;
      return true;
    } catch {
      return false;
    }
  }

  // ============ 导入导出 ============

  /**
   * 导出树
   */
  exportTree(rootUuid?: string): SerializedTree {
    const targetUuid = rootUuid || this.getRoots()[0]?.uuid;
    if (!targetUuid) {
      return { version: '1.0.0', rootUuid: '', nodes: [], exportedAt: Date.now() };
    }
    const root = this.nodes.get(targetUuid);
    if (!root) {
      return { version: '1.0.0', rootUuid: '', nodes: [], exportedAt: Date.now() };
    }
    // 递归收集节点
    const nodes: SerializedTree['nodes'] = [];
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      nodes.push({
        uuid: current.uuid,
        path: current.path,
        parentUuid: current.parentUuid,
        config: current.config,
        depth: current.depth,
        status: current.status,
        children: [...current.children],
        currentTask: current.currentTask,
        completedTasks: current.completedTasks,
        failedTasks: current.failedTasks,
        createdAt: current.createdAt,
        startedAt: current.startedAt,
        completedAt: current.completedAt,
        tokensUsed: current.tokensUsed,
        contextUsage: current.contextUsage,
        error: current.error,
        metadata: current.metadata,
      });
      stack.push(...current.children.map((c) => this.nodes.get(c)).filter(Boolean) as SubAgentNode[]);
    }
    return {
      version: '1.0.0',
      rootUuid: targetUuid,
      nodes,
      exportedAt: Date.now(),
    };
  }

  /**
   * 导入树
   */
  importTree(data: SerializedTree): string {
    if (!data || data.version !== '1.0.0') {
      throw new InvalidConfigError(`Unsupported tree version: ${data?.version}`);
    }
    // 重建节点
    for (const n of data.nodes) {
      const node: SubAgentNode = {
        uuid: n.uuid,
        path: n.path,
        parentUuid: n.parentUuid,
        config: n.config,
        depth: n.depth,
        status: n.status === 'running' ? 'paused' : n.status, // 运行中状态转为暂停
        children: [...n.children],
        currentTask: n.currentTask,
        completedTasks: n.completedTasks,
        failedTasks: n.failedTasks,
        createdAt: n.createdAt,
        startedAt: n.startedAt,
        completedAt: n.completedAt,
        tokensUsed: n.tokensUsed,
        contextUsage: n.contextUsage,
        error: n.error,
        metadata: n.metadata,
      };
      this.nodes.set(n.uuid, node);
    }
    this.save();
    this.emit({
      type: 'tree-restored',
      timestamp: Date.now(),
      agentUuid: data.rootUuid,
      agentPath: this.nodes.get(data.rootUuid)?.path || '',
      data: { nodeCount: data.nodes.length },
    });
    return data.rootUuid;
  }

  // ============ 统计 ============

  /**
   * 获取统计信息
   */
  getStats(): NestedSubAgentStats {
    let totalAgents = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalTokensUsed = 0;
    let totalDepth = 0;
    let maxDepthReached = 0;
    const byRole: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const node of this.nodes.values()) {
      totalAgents++;
      if (node.status === 'completed') totalCompleted++;
      if (node.status === 'failed') totalFailed++;
      totalTokensUsed += node.tokensUsed;
      totalDepth += node.depth;
      if (node.depth > maxDepthReached) maxDepthReached = node.depth;
      byRole[node.config.role] = (byRole[node.config.role] || 0) + 1;
      byStatus[node.status] = (byStatus[node.status] || 0) + 1;
    }
    return {
      totalAgents,
      totalCompleted,
      totalFailed,
      totalTokensUsed,
      averageDepth: totalAgents > 0 ? totalDepth / totalAgents : 0,
      maxDepthReached,
      byRole: byRole as Record<AgentRole, number>,
      byStatus: byStatus as Record<AgentStatus, number>,
    };
  }

  /**
   * 清除所有节点
   */
  clear(): void {
    // 清理所有定时器
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.nodes.clear();
    this.runningCount = 0;
    this.save();
  }

  /**
   * 获取所有节点
   */
  getAllNodes(): SubAgentNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * 获取配置
   */
  getConfig(): NestedSubAgentConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<NestedSubAgentConfig>): void {
    this.config = { ...this.config, ...updates };
  }
}

// ============ 单例管理 ============

/**
 * 默认引擎实例
 */
let defaultEngineInstance: NestedSubAgentEngine | null = null;

/**
 * 获取默认引擎
 */
export function getDefaultNestedSubAgentEngine(): NestedSubAgentEngine {
  if (!defaultEngineInstance) {
    defaultEngineInstance = new NestedSubAgentEngine();
  }
  return defaultEngineInstance;
}

/**
 * 重置默认引擎（用于测试）
 */
export function resetDefaultNestedSubAgentEngine(): void {
  if (defaultEngineInstance) {
    defaultEngineInstance.clear();
  }
  defaultEngineInstance = null;
}
