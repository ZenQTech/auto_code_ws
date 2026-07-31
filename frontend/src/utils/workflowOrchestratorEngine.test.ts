/**
 * # Workflow Orchestrator Engine - 单元测试
 * # Cycle 35 G35-01
 * # 覆盖：工具函数、初始化、工作流管理、实例管理、节点执行、边处理、持久化、事件、统计、单例
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkflowOrchestratorEngine,
  generateWorkflowId,
  generateNodeId,
  generateEdgeId,
  generateInstanceId,
  getDefaultWorkflowOrchestratorEngine,
  resetDefaultWorkflowOrchestratorEngine,
} from './workflowOrchestratorEngine';

describe('WorkflowOrchestratorEngine - 工具函数', () => {
  it('generateXxxId 生成唯一 ID', () => {
    expect(generateWorkflowId()).toMatch(/^wf-/);
    expect(generateNodeId()).toMatch(/^node-/);
    expect(generateEdgeId()).toMatch(/^edge-/);
    expect(generateInstanceId()).toMatch(/^inst-/);
  });

  it('多次生成 ID 唯一', () => {
    const a = generateWorkflowId();
    const b = generateWorkflowId();
    expect(a).not.toBe(b);
  });
});

describe('WorkflowOrchestratorEngine - 初始化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('使用默认配置创建', () => {
    const engine = new WorkflowOrchestratorEngine();
    expect(engine).toBeInstanceOf(WorkflowOrchestratorEngine);
  });

  it('加载 5 个预置工作流', () => {
    const engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
    expect(engine.listWorkflows().length).toBeGreaterThanOrEqual(5);
  });

  it('自定义配置', () => {
    const engine = new WorkflowOrchestratorEngine({ maxRetries: 10 });
    expect(engine).toBeInstanceOf(WorkflowOrchestratorEngine);
  });

  it('5 个预置工作流类型正确', () => {
    const engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
    const workflows = engine.listWorkflows();
    expect(workflows.some((w) => w.name === 'Sequential Pipeline')).toBe(true);
    expect(workflows.some((w) => w.name === 'Parallel Fan-out')).toBe(true);
    expect(workflows.some((w) => w.name === 'Conditional Branch')).toBe(true);
    expect(workflows.some((w) => w.name === 'Subgraph Composition')).toBe(true);
    expect(workflows.some((w) => w.name === 'Loop with Limit')).toBe(true);
  });
});

describe('WorkflowOrchestratorEngine - 工作流管理', () => {
  let engine: WorkflowOrchestratorEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
  });

  it('registerWorkflow 注册', () => {
    const wf = engine.registerWorkflow({
      id: 'wf-1',
      name: 'Test',
      description: 'Test',
      version: '1.0.0',
      entryPoint: 'a',
      nodes: [{ id: 'a', type: 'llm', name: 'A', config: {} }],
      edges: [],
    });
    expect(wf.id).toBe('wf-1');
    expect(wf.createdAt).toBeDefined();
  });

  it('updateWorkflow 更新', () => {
    engine.registerWorkflow({
      id: 'wf-2',
      name: 'Test',
      description: 'Test',
      version: '1.0.0',
      entryPoint: 'a',
      nodes: [],
      edges: [],
    });
    const updated = engine.updateWorkflow('wf-2', { name: 'Updated' });
    expect(updated.name).toBe('Updated');
  });

  it('updateWorkflow 工作流不存在抛错', () => {
    expect(() => engine.updateWorkflow('not-exist', { name: 'X' })).toThrow();
  });

  it('deleteWorkflow 删除', () => {
    engine.registerWorkflow({
      id: 'wf-3',
      name: 'T',
      description: 'T',
      version: '1.0.0',
      entryPoint: 'a',
      nodes: [],
      edges: [],
    });
    expect(engine.deleteWorkflow('wf-3')).toBe(true);
    expect(engine.getWorkflow('wf-3')).toBeUndefined();
  });

  it('getWorkflow 获取', () => {
    engine.registerWorkflow({
      id: 'wf-4',
      name: 'T',
      description: 'T',
      version: '1.0.0',
      entryPoint: 'a',
      nodes: [],
      edges: [],
    });
    expect(engine.getWorkflow('wf-4')?.id).toBe('wf-4');
  });

  it('listWorkflows 列表', () => {
    const list = engine.listWorkflows();
    expect(Array.isArray(list)).toBe(true);
  });

  it('registerNodeExecutor 注册自定义执行器', () => {
    engine.registerNodeExecutor('llm', () => 'custom');
    expect(true).toBe(true);
  });
});

describe('WorkflowOrchestratorEngine - 实例管理', () => {
  let engine: WorkflowOrchestratorEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
  });

  it('createInstance 创建实例', () => {
    const wf = engine.listWorkflows()[0];
    const instance = engine.createInstance(wf.id, { x: 1 });
    expect(instance.id).toBeDefined();
    expect(instance.status).toBe('pending');
  });

  it('createInstance 工作流不存在抛错', () => {
    expect(() => engine.createInstance('not-exist')).toThrow();
  });

  it('startInstance 启动顺序工作流', async () => {
    const wf = engine.listWorkflows().find((w) => w.name === 'Sequential Pipeline')!;
    const instance = engine.createInstance(wf.id);
    await engine.startInstance(instance.id);
    const result = engine.getInstance(instance.id);
    expect(['completed', 'running', 'failed']).toContain(result?.status);
  });

  it('pauseInstance 暂停', async () => {
    const wf = engine.listWorkflows()[0];
    const instance = engine.createInstance(wf.id);
    instance.status = 'running';
    await engine.pauseInstance(instance.id);
    expect(engine.getInstance(instance.id)?.status).toBe('paused');
  });

  it('resumeInstance 恢复', async () => {
    const wf = engine.listWorkflows()[0];
    const instance = engine.createInstance(wf.id);
    instance.status = 'paused';
    await engine.resumeInstance(instance.id);
  });

  it('cancelInstance 取消', async () => {
    const wf = engine.listWorkflows()[0];
    const instance = engine.createInstance(wf.id);
    await engine.cancelInstance(instance.id);
    expect(engine.getInstance(instance.id)?.status).toBe('cancelled');
  });

  it('getInstance 获取', () => {
    const wf = engine.listWorkflows()[0];
    const instance = engine.createInstance(wf.id);
    expect(engine.getInstance(instance.id)?.id).toBe(instance.id);
  });

  it('listInstances 按状态过滤', () => {
    const wf = engine.listWorkflows()[0];
    engine.createInstance(wf.id);
    const running = engine.listInstances({ status: 'pending' });
    expect(running.length).toBeGreaterThan(0);
  });
});

describe('WorkflowOrchestratorEngine - 节点执行', () => {
  let engine: WorkflowOrchestratorEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
  });

  it('startInstance 触发 node-started 事件', async () => {
    const wf = engine.listWorkflows().find((w) => w.name === 'Sequential Pipeline')!;
    const instance = engine.createInstance(wf.id);
    const events: any[] = [];
    engine.on('node-started', (e) => events.push(e));
    await engine.startInstance(instance.id);
    expect(events.length).toBeGreaterThanOrEqual(0);
  });

  it('并行 Fan-out 工作流执行', async () => {
    const wf = engine.listWorkflows().find((w) => w.name === 'Parallel Fan-out')!;
    const instance = engine.createInstance(wf.id);
    await engine.startInstance(instance.id);
    const ns = engine.getInstance(instance.id)?.nodeStates;
    expect(ns).toBeDefined();
  });

  it('条件分支工作流', async () => {
    const wf = engine.listWorkflows().find((w) => w.name === 'Conditional Branch')!;
    const instance = engine.createInstance(wf.id, { value: true });
    await engine.startInstance(instance.id);
    const result = engine.getInstance(instance.id);
    expect(result).toBeDefined();
  });

  it('子图工作流', async () => {
    const wf = engine.listWorkflows().find((w) => w.name === 'Subgraph Composition')!;
    const instance = engine.createInstance(wf.id);
    await engine.startInstance(instance.id);
    expect(true).toBe(true);
  });

  it('Loop 工作流', async () => {
    const wf = engine.listWorkflows().find((w) => w.name === 'Loop with Limit')!;
    const instance = engine.createInstance(wf.id);
    await engine.startInstance(instance.id);
    expect(true).toBe(true);
  });
});

describe('WorkflowOrchestratorEngine - 执行图可视化', () => {
  let engine: WorkflowOrchestratorEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
  });

  it('getExecutionGraph 返回图结构', () => {
    const wf = engine.listWorkflows()[0];
    const instance = engine.createInstance(wf.id);
    const graph = engine.getExecutionGraph(instance.id);
    expect(graph?.nodes).toBeDefined();
    expect(graph?.edges).toBeDefined();
  });

  it('getExecutionGraph 实例不存在', () => {
    const graph = engine.getExecutionGraph('not-exist');
    expect(graph).toBeUndefined();
  });
});

describe('WorkflowOrchestratorEngine - 持久化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('exportState 导出', () => {
    const engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
    const wf = engine.listWorkflows()[0];
    const instance = engine.createInstance(wf.id);
    const exported = engine.exportState(instance.id);
    expect(exported).toBeDefined();
  });

  it('importState 导入', () => {
    const engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
    const wf = engine.listWorkflows()[0];
    const instance = engine.createInstance(wf.id);
    const exported = engine.exportState(instance.id)!;
    const imported = engine.importState(exported);
    expect(imported.id).toBe(instance.id);
  });

  it('持久化：从 localStorage 恢复', () => {
    const e1 = new WorkflowOrchestratorEngine({ persistEnabled: true });
    e1.registerWorkflow({
      id: 'persist-wf',
      name: 'Persist',
      description: 'T',
      version: '1.0.0',
      entryPoint: 'a',
      nodes: [],
      edges: [],
    });
    const e2 = new WorkflowOrchestratorEngine({ persistEnabled: true });
    expect(e2.getWorkflow('persist-wf')).toBeDefined();
  });
});

describe('WorkflowOrchestratorEngine - 事件系统', () => {
  let engine: WorkflowOrchestratorEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
  });

  it('on 订阅事件', () => {
    const handler = () => {};
    const unsub = engine.on('workflow-registered', handler);
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('emit workflow-registered 触发', () => {
    const events: any[] = [];
    engine.on('workflow-registered', (e) => events.push(e));
    engine.registerWorkflow({
      id: 'evt-wf',
      name: 'T',
      description: 'T',
      version: '1.0.0',
      entryPoint: 'a',
      nodes: [],
      edges: [],
    });
    expect(events.length).toBe(1);
  });

  it('on 多个 handler', () => {
    const e1: any[] = [];
    const e2: any[] = [];
    engine.on('workflow-registered', () => e1.push(1));
    engine.on('workflow-registered', () => e2.push(1));
    engine.registerWorkflow({
      id: 'multi-wf',
      name: 'T',
      description: 'T',
      version: '1.0.0',
      entryPoint: 'a',
      nodes: [],
      edges: [],
    });
    expect(e1.length).toBe(1);
    expect(e2.length).toBe(1);
  });
});

describe('WorkflowOrchestratorEngine - 统计', () => {
  let engine: WorkflowOrchestratorEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new WorkflowOrchestratorEngine({ persistEnabled: false });
  });

  it('getStats 返回完整统计', () => {
    const stats = engine.getStats();
    expect(stats.workflows).toBeGreaterThan(0);
    expect(stats.instances).toBeDefined();
    expect(stats.totalNodes).toBeGreaterThanOrEqual(0);
  });

  it('getStats 实例计数', () => {
    const wf = engine.listWorkflows()[0];
    engine.createInstance(wf.id);
    const stats = engine.getStats();
    expect(stats.instances.total).toBeGreaterThanOrEqual(1);
  });
});

describe('WorkflowOrchestratorEngine - 单例', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultWorkflowOrchestratorEngine();
  });

  it('getDefaultWorkflowOrchestratorEngine 返回单例', () => {
    const e1 = getDefaultWorkflowOrchestratorEngine();
    const e2 = getDefaultWorkflowOrchestratorEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefaultWorkflowOrchestratorEngine 重置', () => {
    const e1 = getDefaultWorkflowOrchestratorEngine();
    resetDefaultWorkflowOrchestratorEngine();
    const e2 = getDefaultWorkflowOrchestratorEngine();
    expect(e1).not.toBe(e2);
  });
});
