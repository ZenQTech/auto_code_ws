/**
 * # ============================================================
 * # Workflow Orchestrator Engine - 工作流编排引擎 (v1.0.0 Cycle 35 G35-01)
 * # ============================================================
 * # 核心作用：基于 DAG 的工作流编排引擎，支持节点并行/条件分支/嵌套子图/可视化执行
 * # 对标产品：LangGraph / Prefect / Apache Airflow
 * # 运行流程：
 * #   1. registerWorkflow(def) 注册工作流定义
 * #   2. createInstance(defId, ctx) 创建工作流实例
 * #   3. startInstance(id) 启动执行
 * #   4. 引擎按依赖顺序执行节点，支持条件边与并行
 * #   5. pause/resume/cancel 控制生命周期
 * #   6. 提供 getExecutionGraph 用于可视化
 * # 输入参数：WorkflowDefinition / WorkflowInstance
 * # 输出结果：NodeState / ExecutionGraph
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 35 G35-01 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/**
 * 节点类型
 */
export type NodeType =
  | 'llm'
  | 'tool'
  | 'code'
  | 'condition'
  | 'parallel'
  | 'subgraph';

/**
 * 边类型
 */
export type EdgeType = 'default' | 'conditional' | 'parallel' | 'fallback';

/**
 * 工作流节点定义
 */
export interface WorkflowNode {
  id: string;
  type: NodeType;
  name: string;
  config: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  timeoutMs?: number;
  retryCount?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 工作流边定义
 */
export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  condition?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 工作流定义
 */
export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryPoint: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 节点执行器接口
 */
export type NodeExecutor = (
  node: WorkflowNode,
  context: Record<string, unknown>,
) => Promise<unknown> | unknown;

/**
 * 节点状态
 */
export interface NodeState {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: number;
  endTime?: number;
  output?: unknown;
  error?: string;
  attempts: number;
  durationMs?: number;
}

/**
 * 工作流实例
 */
export interface WorkflowInstance {
  id: string;
  definitionId: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  startTime?: number;
  endTime?: number;
  nodeStates: Record<string, NodeState>;
  context: Record<string, unknown>;
  error?: string;
  currentNodes: string[];
  metadata?: Record<string, unknown>;
}

/**
 * 执行图（用于可视化）
 */
export interface ExecutionGraph {
  instanceId: string;
  nodes: Array<{
    id: string;
    label: string;
    type: NodeType;
    status: string;
    x: number;
    y: number;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    type: EdgeType;
    label?: string;
  }>;
}

/**
 * 引擎配置
 */
export interface OrchestratorConfig {
  maxConcurrentInstances: number;
  maxConcurrentNodes: number;
  defaultTimeoutMs: number;
  maxRetries: number;
  persistEnabled: boolean;
  visualizationEnabled: boolean;
  eventHistorySize: number;
}

/**
 * 引擎事件
 */
export type OrchestratorEvent =
  | 'workflow-registered'
  | 'workflow-updated'
  | 'workflow-deleted'
  | 'instance-created'
  | 'instance-started'
  | 'instance-paused'
  | 'instance-resumed'
  | 'instance-completed'
  | 'instance-failed'
  | 'instance-cancelled'
  | 'node-started'
  | 'node-completed'
  | 'node-failed'
  | 'node-skipped';

// ============ 默认配置 ============

export const DEFAULT_ORCHESTRATOR_CONFIG: OrchestratorConfig = {
  maxConcurrentInstances: 100,
  maxConcurrentNodes: 50,
  defaultTimeoutMs: 30000,
  maxRetries: 3,
  persistEnabled: true,
  visualizationEnabled: true,
  eventHistorySize: 1000,
};

// ============ 工具函数 ============

export function generateWorkflowId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateNodeId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateEdgeId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateInstanceId(): string {
  return `inst-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============ 预置工作流 ============

export const PRESET_WORKFLOWS: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Sequential Pipeline',
    description: 'A → B → C 顺序管道',
    version: '1.0.0',
    entryPoint: 'node-a',
    nodes: [
      { id: 'node-a', type: 'llm', name: 'Step A', config: { prompt: 'A' }, timeoutMs: 5000 },
      { id: 'node-b', type: 'llm', name: 'Step B', config: { prompt: 'B' }, timeoutMs: 5000, dependencies: ['node-a'] },
      { id: 'node-c', type: 'llm', name: 'Step C', config: { prompt: 'C' }, timeoutMs: 5000, dependencies: ['node-b'] },
    ],
    edges: [
      { id: 'e1', source: 'node-a', target: 'node-b', type: 'default' },
      { id: 'e2', source: 'node-b', target: 'node-c', type: 'default' },
    ],
  },
  {
    name: 'Parallel Fan-out',
    description: '1 节点 → 3 并行 → 1 聚合',
    version: '1.0.0',
    entryPoint: 'node-source',
    nodes: [
      { id: 'node-source', type: 'llm', name: 'Source', config: {}, timeoutMs: 5000 },
      { id: 'node-p1', type: 'llm', name: 'Parallel 1', config: {}, timeoutMs: 5000, dependencies: ['node-source'] },
      { id: 'node-p2', type: 'llm', name: 'Parallel 2', config: {}, timeoutMs: 5000, dependencies: ['node-source'] },
      { id: 'node-p3', type: 'llm', name: 'Parallel 3', config: {}, timeoutMs: 5000, dependencies: ['node-source'] },
      { id: 'node-agg', type: 'tool', name: 'Aggregator', config: {}, timeoutMs: 5000, dependencies: ['node-p1', 'node-p2', 'node-p3'] },
    ],
    edges: [
      { id: 'e1', source: 'node-source', target: 'node-p1', type: 'parallel' },
      { id: 'e2', source: 'node-source', target: 'node-p2', type: 'parallel' },
      { id: 'e3', source: 'node-source', target: 'node-p3', type: 'parallel' },
      { id: 'e4', source: 'node-p1', target: 'node-agg', type: 'default' },
      { id: 'e5', source: 'node-p2', target: 'node-agg', type: 'default' },
      { id: 'e6', source: 'node-p3', target: 'node-agg', type: 'default' },
    ],
  },
  {
    name: 'Conditional Branch',
    description: '条件分支：A → B 或 C',
    version: '1.0.0',
    entryPoint: 'node-cond',
    nodes: [
      { id: 'node-cond', type: 'condition', name: 'Branch', config: { trueLabel: 'A', falseLabel: 'B' }, timeoutMs: 1000 },
      { id: 'node-a', type: 'llm', name: 'True Path', config: {}, dependencies: ['node-cond'] },
      { id: 'node-b', type: 'llm', name: 'False Path', config: {}, dependencies: ['node-cond'] },
    ],
    edges: [
      { id: 'e1', source: 'node-cond', target: 'node-a', type: 'conditional', condition: 'true' },
      { id: 'e2', source: 'node-cond', target: 'node-b', type: 'conditional', condition: 'false' },
    ],
  },
  {
    name: 'Subgraph Composition',
    description: '主图 + 子图',
    version: '1.0.0',
    entryPoint: 'node-main-start',
    nodes: [
      { id: 'node-main-start', type: 'llm', name: 'Main Start', config: {}, timeoutMs: 5000 },
      { id: 'node-sub', type: 'subgraph', name: 'Subgraph A', config: { subgraphId: 'sub-a' }, timeoutMs: 10000, dependencies: ['node-main-start'] },
      { id: 'node-main-end', type: 'llm', name: 'Main End', config: {}, timeoutMs: 5000, dependencies: ['node-sub'] },
    ],
    edges: [
      { id: 'e1', source: 'node-main-start', target: 'node-sub', type: 'default' },
      { id: 'e2', source: 'node-sub', target: 'node-main-end', type: 'default' },
    ],
  },
  {
    name: 'Loop with Limit',
    description: 'A → B → (回 A) → C（限 3 次）',
    version: '1.0.0',
    entryPoint: 'node-init',
    nodes: [
      { id: 'node-init', type: 'llm', name: 'Init', config: { counter: 0 }, timeoutMs: 5000 },
      { id: 'node-loop', type: 'llm', name: 'Loop', config: {}, timeoutMs: 5000, dependencies: ['node-init'] },
      { id: 'node-done', type: 'llm', name: 'Done', config: {}, dependencies: ['node-loop'] },
    ],
    edges: [
      { id: 'e1', source: 'node-init', target: 'node-loop', type: 'default' },
      { id: 'e2', source: 'node-loop', target: 'node-init', type: 'conditional', condition: 'continue' },
      { id: 'e3', source: 'node-loop', target: 'node-done', type: 'conditional', condition: 'stop' },
    ],
  },
];

// ============ 引擎实现 ============

export class WorkflowOrchestratorEngine {
  private workflows: Map<string, WorkflowDefinition> = new Map();
  private instances: Map<string, WorkflowInstance> = new Map();
  private executors: Map<NodeType, NodeExecutor> = new Map();
  private config: OrchestratorConfig;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  private storageKey: string;

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.storageKey = 'workflow-orchestrator';
    this.registerDefaultExecutors();
    this.loadFromStorage();
    if (this.workflows.size === 0) {
      this.loadPresetWorkflows();
    }
  }

  // ============ 存储 ============

  private loadFromStorage(): void {
    if (!this.config.persistEnabled || typeof localStorage === 'undefined') return;
    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.workflows) {
          for (const wf of parsed.workflows) {
            this.workflows.set(wf.id, wf);
          }
        }
        if (parsed.instances) {
          for (const inst of parsed.instances) {
            this.instances.set(inst.id, inst);
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  private saveToStorage(): void {
    if (!this.config.persistEnabled || typeof localStorage === 'undefined') return;
    try {
      const data = {
        workflows: Array.from(this.workflows.values()),
        instances: Array.from(this.instances.values()).slice(-100),
      };
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch (e) {
      // ignore
    }
  }

  private loadPresetWorkflows(): void {
    const now = Date.now();
    for (let i = 0; i < PRESET_WORKFLOWS.length; i++) {
      const preset = PRESET_WORKFLOWS[i];
      const id = `preset-wf-${i + 1}`;
      this.workflows.set(id, {
        ...preset,
        id,
        createdAt: now,
        updatedAt: now,
      });
    }
    this.saveToStorage();
  }

  // ============ 默认执行器 ============

  private registerDefaultExecutors(): void {
    this.executors.set('llm', async (node, ctx) => {
      await new Promise((r) => setTimeout(r, 10));
      return { result: `llm-${node.id}-${Date.now()}`, input: ctx };
    });
    this.executors.set('tool', async (node, ctx) => {
      await new Promise((r) => setTimeout(r, 5));
      return { toolResult: node.id, input: ctx };
    });
    this.executors.set('code', async (_node, ctx) => {
      await new Promise((r) => setTimeout(r, 5));
      return { codeResult: 'success', input: ctx };
    });
    this.executors.set('condition', async (_node, ctx) => {
      // Mock: 根据 ctx 决定 true/false
      const value = (ctx as any).value;
      return { branch: value === true ? 'true' : 'false' };
    });
    this.executors.set('parallel', async (node, ctx) => {
      return { parallel: true, node: node.id, ctx };
    });
    this.executors.set('subgraph', async (node, ctx) => {
      return { subgraph: node.config.subgraphId, ctx };
    });
  }

  // ============ 工作流管理 ============

  registerWorkflow(definition: Omit<WorkflowDefinition, 'createdAt' | 'updatedAt'>): WorkflowDefinition {
    const now = Date.now();
    const id = definition.id || generateWorkflowId();
    const full: WorkflowDefinition = {
      ...definition,
      id,
      createdAt: now,
      updatedAt: now,
    };
    this.workflows.set(id, full);
    this.saveToStorage();
    this.emit('workflow-registered', full);
    return full;
  }

  updateWorkflow(id: string, updates: Partial<WorkflowDefinition>): WorkflowDefinition {
    const existing = this.workflows.get(id);
    if (!existing) throw new Error(`Workflow ${id} not found`);
    const updated = { ...existing, ...updates, id, updatedAt: Date.now() };
    this.workflows.set(id, updated);
    this.saveToStorage();
    this.emit('workflow-updated', updated);
    return updated;
  }

  deleteWorkflow(id: string): boolean {
    const result = this.workflows.delete(id);
    if (result) {
      this.saveToStorage();
      this.emit('workflow-deleted', { id });
    }
    return result;
  }

  getWorkflow(id: string): WorkflowDefinition | undefined {
    return this.workflows.get(id);
  }

  listWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values());
  }

  // ============ 实例管理 ============

  createInstance(
    definitionId: string,
    initialContext: Record<string, unknown> = {},
  ): WorkflowInstance {
    const def = this.workflows.get(definitionId);
    if (!def) throw new Error(`Workflow ${definitionId} not found`);
    const id = generateInstanceId();
    const nodeStates: Record<string, NodeState> = {};
    for (const node of def.nodes) {
      nodeStates[node.id] = {
        nodeId: node.id,
        status: 'pending',
        attempts: 0,
      };
    }
    const instance: WorkflowInstance = {
      id,
      definitionId,
      status: 'pending',
      nodeStates,
      context: { ...initialContext },
      currentNodes: [def.entryPoint],
    };
    this.instances.set(id, instance);
    this.saveToStorage();
    this.emit('instance-created', instance);
    return instance;
  }

  async startInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) throw new Error(`Instance ${instanceId} not found`);
    if (instance.status !== 'pending' && instance.status !== 'paused') {
      throw new Error(`Cannot start instance in status ${instance.status}`);
    }
    instance.status = 'running';
    instance.startTime = Date.now();
    this.emit('instance-started', instance);
    await this.executeInstance(instance);
  }

  async pauseInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    if (instance.status !== 'running') return;
    instance.status = 'paused';
    this.saveToStorage();
    this.emit('instance-paused', instance);
  }

  async resumeInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    if (instance.status !== 'paused') return;
    instance.status = 'running';
    this.emit('instance-resumed', instance);
    await this.executeInstance(instance);
  }

  async cancelInstance(instanceId: string): Promise<void> {
    const instance = this.instances.get(instanceId);
    if (!instance) return;
    instance.status = 'cancelled';
    instance.endTime = Date.now();
    this.saveToStorage();
    this.emit('instance-cancelled', instance);
  }

  getInstance(instanceId: string): WorkflowInstance | undefined {
    return this.instances.get(instanceId);
  }

  listInstances(filter?: { status?: string; definitionId?: string }): WorkflowInstance[] {
    let list = Array.from(this.instances.values());
    if (filter?.status) {
      list = list.filter((i) => i.status === filter.status);
    }
    if (filter?.definitionId) {
      list = list.filter((i) => i.definitionId === filter.definitionId);
    }
    return list;
  }

  // ============ 节点执行 ============

  registerNodeExecutor(type: NodeType, executor: NodeExecutor): void {
    this.executors.set(type, executor);
  }

  // ============ 执行引擎 ============

  private async executeInstance(instance: WorkflowInstance): Promise<void> {
    const def = this.workflows.get(instance.definitionId);
    if (!def) return;

    try {
      while (instance.status === 'running' && instance.currentNodes.length > 0) {
        const promises: Promise<void>[] = [];

        for (const nodeId of instance.currentNodes) {
          // 检查所有依赖已完成
          const node = def.nodes.find((n) => n.id === nodeId);
          if (!node) continue;
          if (node.dependencies && node.dependencies.length > 0) {
            const allDepsReady = node.dependencies.every(
              (dep) => instance.nodeStates[dep]?.status === 'completed',
            );
            if (!allDepsReady) continue;
          }
          // 检查状态
          const ns = instance.nodeStates[nodeId];
          if (ns.status === 'completed' || ns.status === 'skipped') continue;
          if (ns.status === 'running') continue;
          promises.push(this.executeNode(instance, node, def));
        }

        if (promises.length === 0) break;
        await Promise.all(promises);

        // 推进 currentNodes 到下一批
        instance.currentNodes = this.findNextNodes(instance, def);
        this.saveToStorage();
      }

      if (instance.status === 'running') {
        instance.status = 'completed';
        instance.endTime = Date.now();
        this.saveToStorage();
        this.emit('instance-completed', instance);
      }
    } catch (e: any) {
      instance.status = 'failed';
      instance.endTime = Date.now();
      instance.error = e.message;
      this.saveToStorage();
      this.emit('instance-failed', instance);
    }
  }

  private async executeNode(
    instance: WorkflowInstance,
    node: WorkflowNode,
    def: WorkflowDefinition,
  ): Promise<void> {
    const ns = instance.nodeStates[node.id];
    ns.status = 'running';
    ns.startTime = Date.now();
    ns.attempts += 1;
    this.emit('node-started', { instanceId: instance.id, nodeId: node.id });

    try {
      const executor = this.executors.get(node.type);
      if (!executor) throw new Error(`No executor for type ${node.type}`);
      const output = await Promise.race([
        Promise.resolve(executor(node, instance.context)),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), node.timeoutMs || this.config.defaultTimeoutMs),
        ),
      ]);
      ns.output = output;
      ns.status = 'completed';
      ns.endTime = Date.now();
      ns.durationMs = ns.endTime - ns.startTime!;
      // 更新 context
      (instance.context as any)[node.id] = output;
      this.emit('node-completed', { instanceId: instance.id, nodeId: node.id, output });
    } catch (e: any) {
      ns.status = 'failed';
      ns.endTime = Date.now();
      ns.error = e.message;
      ns.durationMs = ns.endTime - ns.startTime!;
      this.emit('node-failed', { instanceId: instance.id, nodeId: node.id, error: e.message });
      if (ns.attempts < (node.retryCount || 0)) {
        // 重试
        ns.status = 'pending';
        return;
      }
      // 查找 fallback 边
      const fallback = def.edges.find(
        (e) => e.source === node.id && e.type === 'fallback',
      );
      if (fallback) {
        ns.status = 'skipped';
        this.emit('node-skipped', { instanceId: instance.id, nodeId: node.id });
      }
    }
  }

  private findNextNodes(instance: WorkflowInstance, def: WorkflowDefinition): string[] {
    const next = new Set<string>();
    for (const nodeId of Object.keys(instance.nodeStates)) {
      const ns = instance.nodeStates[nodeId];
      if (ns.status !== 'completed') continue;
      const outgoing = def.edges.filter((e) => e.source === nodeId);
      for (const edge of outgoing) {
        if (edge.type === 'conditional') {
          // Mock 条件评估
          if (this.evaluateCondition(edge.condition || '', instance.context)) {
            next.add(edge.target);
          }
        } else if (edge.type === 'fallback') {
          // 失败时已处理
          continue;
        } else {
          next.add(edge.target);
        }
      }
    }
    return Array.from(next);
  }

  private evaluateCondition(condition: string, _context: Record<string, unknown>): boolean {
    // 简化实现：true/false/continue/stop
    if (condition === 'true' || condition === 'continue') return true;
    if (condition === 'false' || condition === 'stop') return false;
    return true;
  }

  // ============ 执行图（可视化） ============

  getExecutionGraph(instanceId: string): ExecutionGraph | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance) return undefined;
    const def = this.workflows.get(instance.definitionId);
    if (!def) return undefined;

    const nodes = def.nodes.map((node, idx) => ({
      id: node.id,
      label: node.name,
      type: node.type,
      status: instance.nodeStates[node.id]?.status || 'pending',
      x: (idx % 3) * 200,
      y: Math.floor(idx / 3) * 150,
    }));

    const edges = def.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type,
      label: edge.condition,
    }));

    return { instanceId, nodes, edges };
  }

  // ============ 持久化 ============

  exportState(instanceId: string): string | undefined {
    const instance = this.instances.get(instanceId);
    if (!instance) return undefined;
    return JSON.stringify(instance);
  }

  importState(serialized: string): WorkflowInstance {
    const instance = JSON.parse(serialized) as WorkflowInstance;
    this.instances.set(instance.id, instance);
    this.saveToStorage();
    return instance;
  }

  // ============ 统计 ============

  getStats() {
    const instances = Array.from(this.instances.values());
    const totalNodes = instances.reduce(
      (sum, instance) => sum + Object.keys(instance.nodeStates).length,
      0,
    );
    return {
      workflows: this.workflows.size,
      instances: {
        total: instances.length,
        running: instances.filter((i) => i.status === 'running').length,
        completed: instances.filter((i) => i.status === 'completed').length,
        failed: instances.filter((i) => i.status === 'failed').length,
        paused: instances.filter((i) => i.status === 'paused').length,
        cancelled: instances.filter((i) => i.status === 'cancelled').length,
      },
      totalNodes,
    };
  }

  // ============ 事件系统 ============

  on(event: OrchestratorEvent, handler: (data: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(handler);
    return () => {
      const list = this.listeners.get(event);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  private emit(event: OrchestratorEvent, data: any): void {
    const list = this.listeners.get(event);
    if (list) {
      for (const h of list) {
        try {
          h(data);
        } catch (e) {
          // ignore handler errors
        }
      }
    }
  }
}

// ============ 单例 ============

let defaultEngine: WorkflowOrchestratorEngine | null = null;

export function getDefaultWorkflowOrchestratorEngine(): WorkflowOrchestratorEngine {
  if (!defaultEngine) {
    defaultEngine = new WorkflowOrchestratorEngine();
  }
  return defaultEngine;
}

export function resetDefaultWorkflowOrchestratorEngine(): void {
  defaultEngine = null;
}
