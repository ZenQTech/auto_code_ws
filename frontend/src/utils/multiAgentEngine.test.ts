/**
 * # MultiAgentEngine - 单元测试
 * # Cycle 38 G38-01
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MultiAgentEngine,
  createMultiAgentEngine,
  getDefaultMultiAgentEngine,
  resetDefaultMultiAgentEngine,
  MessageBus,
  TaskScheduler,
  WorkerAgent,
  ManagerAgent,
  generateId,
  defaultLLMProvider,
  AgentDefinition,
  TaskDefinition,
  Crew,
} from './multiAgentEngine';

describe('工具函数', () => {
  it('generateId 格式正确', () => {
    const id = generateId();
    expect(id).toMatch(/^ma-/);
  });

  it('defaultLLMProvider 返回 JSON 格式', async () => {
    const result = await defaultLLMProvider('分解任务为 JSON');
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('defaultLLMProvider 普通模式', async () => {
    const result = await defaultLLMProvider('hello');
    expect(result).toContain('Mock response');
  });
});

describe('MessageBus', () => {
  let bus: MessageBus;

  beforeEach(() => {
    bus = new MessageBus();
  });

  it('发布与订阅', () => {
    const received: any[] = [];
    bus.subscribe('agent-1', (msg) => received.push(msg));
    bus.publish({
      id: 'm1',
      fromAgentId: 'agent-2',
      toAgentId: 'agent-1',
      type: 'private',
      payload: 'hello',
      timestamp: Date.now(),
    });
    expect(received.length).toBe(1);
    expect(received[0].payload).toBe('hello');
  });

  it('广播消息', () => {
    const a: any[] = [];
    const b: any[] = [];
    bus.subscribe('agent-1', (msg) => a.push(msg));
    bus.subscribe('agent-2', (msg) => b.push(msg));
    bus.publish({
      id: 'm1',
      fromAgentId: 'agent-3',
      toAgentId: 'broadcast',
      type: 'broadcast',
      payload: 'hi all',
      timestamp: Date.now(),
    });
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
  });

  it('取消订阅', () => {
    const received: any[] = [];
    const unsub = bus.subscribe('a1', (msg) => received.push(msg));
    bus.publish({ id: 'm1', fromAgentId: 'a2', toAgentId: 'a1', type: 'private', payload: 1, timestamp: 0 });
    unsub();
    bus.publish({ id: 'm2', fromAgentId: 'a2', toAgentId: 'a1', type: 'private', payload: 2, timestamp: 0 });
    expect(received.length).toBe(1);
  });

  it('getHistory', () => {
    bus.publish({ id: 'm1', fromAgentId: 'a1', toAgentId: 'a2', type: 'private', payload: 1, timestamp: 0 });
    bus.publish({ id: 'm2', fromAgentId: 'a3', toAgentId: 'broadcast', type: 'broadcast', payload: 2, timestamp: 0 });
    // a1 视角：m1 是自己发的，m2 是广播
    const a1History = bus.getHistory('a1');
    expect(a1History.length).toBe(2);
    const allHistory = bus.getHistory();
    expect(allHistory.length).toBe(2);
  });

  it('clear', () => {
    bus.publish({ id: 'm1', fromAgentId: 'a1', toAgentId: 'a2', type: 'private', payload: 1, timestamp: 0 });
    bus.clear();
    expect(bus.size()).toBe(0);
  });

  it('maxHistory 限制', () => {
    const small = new MessageBus({ maxHistory: 2 });
    small.publish({ id: 'm1', fromAgentId: 'a1', toAgentId: 'a2', type: 'private', payload: 1, timestamp: 0 });
    small.publish({ id: 'm2', fromAgentId: 'a1', toAgentId: 'a2', type: 'private', payload: 2, timestamp: 0 });
    small.publish({ id: 'm3', fromAgentId: 'a1', toAgentId: 'a2', type: 'private', payload: 3, timestamp: 0 });
    expect(small.size()).toBe(2);
  });
});

describe('TaskScheduler', () => {
  let scheduler: TaskScheduler;

  beforeEach(() => {
    scheduler = new TaskScheduler();
  });

  it('schedule 和 getReadyTasks', () => {
    const tasks: TaskDefinition[] = [
      { id: 't1', title: 'T1', description: 'd', requiredCapabilities: [] },
    ];
    scheduler.schedule(tasks);
    const ready = scheduler.getReadyTasks();
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('t1');
  });

  it('依赖未满足的任务不会 ready', () => {
    scheduler.schedule([
      { id: 't1', title: 'T1', description: 'd', requiredCapabilities: [] },
      { id: 't2', title: 'T2', description: 'd', requiredCapabilities: [], dependencies: ['t1'] },
    ]);
    const ready = scheduler.getReadyTasks();
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('t1');
  });

  it('markCompleted 后依赖任务 ready', () => {
    scheduler.schedule([
      { id: 't1', title: 'T1', description: 'd', requiredCapabilities: [] },
      { id: 't2', title: 'T2', description: 'd', requiredCapabilities: [], dependencies: ['t1'] },
    ]);
    scheduler.markCompleted('t1');
    const ready = scheduler.getReadyTasks();
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe('t2');
  });

  it('按优先级排序', () => {
    scheduler.schedule([
      { id: 'low', title: 'L', description: 'd', requiredCapabilities: [], priority: 'low' },
      { id: 'urgent', title: 'U', description: 'd', requiredCapabilities: [], priority: 'urgent' },
      { id: 'normal', title: 'N', description: 'd', requiredCapabilities: [], priority: 'normal' },
    ]);
    const ready = scheduler.getReadyTasks();
    expect(ready[0].id).toBe('urgent');
    expect(ready[2].id).toBe('low');
  });

  it('重试计数', () => {
    scheduler.schedule([
      { id: 't1', title: 'T1', description: 'd', requiredCapabilities: [] },
    ]);
    expect(scheduler.canRetry('t1', 3)).toBe(true);
    scheduler.incrementRetry('t1');
    scheduler.incrementRetry('t1');
    scheduler.incrementRetry('t1');
    expect(scheduler.canRetry('t1', 3)).toBe(false);
  });

  it('getCompletedCount / getTotalCount', () => {
    scheduler.schedule([
      { id: 't1', title: 'T1', description: 'd', requiredCapabilities: [] },
      { id: 't2', title: 'T2', description: 'd', requiredCapabilities: [] },
    ]);
    expect(scheduler.getTotalCount()).toBe(2);
    expect(scheduler.getCompletedCount()).toBe(0);
    scheduler.markCompleted('t1');
    expect(scheduler.getCompletedCount()).toBe(1);
  });
});

describe('MultiAgentEngine 主类', () => {
  let engine: MultiAgentEngine;

  beforeEach(() => {
    resetDefaultMultiAgentEngine();
    engine = createMultiAgentEngine({
      llmProvider: async (prompt: string) => {
        return `[Mock LLM] ${prompt.slice(0, 50)}`;
      },
    });
  });

  it('registerAgent 和 listAgents', () => {
    const manager: AgentDefinition = {
      id: 'mgr-1',
      name: 'Manager',
      role: 'manager',
      capabilities: [{ name: 'planning', proficiency: 0.9 }],
    };
    const worker: AgentDefinition = {
      id: 'wkr-1',
      name: 'Worker',
      role: 'worker',
      capabilities: [{ name: 'general', proficiency: 0.8 }],
    };
    engine.registerAgent(manager);
    engine.registerAgent(worker);
    const managers = engine.listAgents({ role: 'manager' });
    const workers = engine.listAgents({ role: 'worker' });
    expect(managers.length).toBe(1);
    expect(workers.length).toBe(1);
  });

  it('unregisterAgent', () => {
    engine.registerAgent({
      id: 'w1',
      name: 'W1',
      role: 'worker',
      capabilities: [],
    });
    expect(engine.unregisterAgent('w1')).toBe(true);
    expect(engine.unregisterAgent('w1')).toBe(false);
  });

  it('createCrew', () => {
    const crew = engine.createCrew({
      name: 'Test Crew',
      agents: [],
      tasks: [],
      executionMode: 'sequential',
    });
    expect(crew.id).toMatch(/^crew-/);
    expect(crew.status).toBe('idle');
  });

  it('executeCrew sequential', async () => {
    engine.registerAgent({
      id: 'mgr',
      name: 'M',
      role: 'manager',
      capabilities: [{ name: 'general', proficiency: 0.9 }],
    });
    engine.registerAgent({
      id: 'w1',
      name: 'W1',
      role: 'worker',
      capabilities: [{ name: 'general', proficiency: 0.8 }],
    });

    const crew = engine.createCrew({
      name: 'C1',
      agents: [],
      tasks: [
        { id: 't1', title: 'T1', description: 'd', requiredCapabilities: ['general'] },
        { id: 't2', title: 'T2', description: 'd', requiredCapabilities: ['general'] },
      ],
      executionMode: 'sequential',
    });

    const result = await engine.executeCrew(crew.id);
    expect(result.totalTasks).toBe(2);
    expect(result.successfulTasks).toBe(2);
  });

  it('executeCrew parallel', async () => {
    engine.registerAgent({
      id: 'w1',
      name: 'W1',
      role: 'worker',
      capabilities: [{ name: 'general', proficiency: 0.8 }],
    });
    engine.registerAgent({
      id: 'w2',
      name: 'W2',
      role: 'worker',
      capabilities: [{ name: 'general', proficiency: 0.8 }],
    });
    engine.registerAgent({
      id: 'w3',
      name: 'W3',
      role: 'worker',
      capabilities: [{ name: 'general', proficiency: 0.8 }],
    });

    const crew = engine.createCrew({
      name: 'C1',
      agents: [],
      tasks: [
        { id: 't1', title: 'T1', description: 'd', requiredCapabilities: ['general'] },
        { id: 't2', title: 'T2', description: 'd', requiredCapabilities: ['general'] },
        { id: 't3', title: 'T3', description: 'd', requiredCapabilities: ['general'] },
      ],
      executionMode: 'parallel',
    });

    const result = await engine.executeCrew(crew.id);
    expect(result.totalTasks).toBe(3);
    expect(result.successfulTasks).toBe(3);
  });

  it('executeCrew hybrid 依赖关系', async () => {
    engine.registerAgent({
      id: 'w1',
      name: 'W1',
      role: 'worker',
      capabilities: [{ name: 'general', proficiency: 0.8 }],
    });

    const crew = engine.createCrew({
      name: 'C1',
      agents: [],
      tasks: [
        { id: 't1', title: 'T1', description: 'd', requiredCapabilities: ['general'] },
        { id: 't2', title: 'T2', description: 'd', requiredCapabilities: ['general'], dependencies: ['t1'] },
        { id: 't3', title: 'T3', description: 'd', requiredCapabilities: ['general'], dependencies: ['t2'] },
      ],
      executionMode: 'hybrid',
    });

    const result = await engine.executeCrew(crew.id);
    expect(result.totalTasks).toBe(3);
    expect(result.successfulTasks).toBe(3);
  });

  it('cancelCrew', async () => {
    engine.registerAgent({
      id: 'w1',
      name: 'W1',
      role: 'worker',
      capabilities: [{ name: 'general', proficiency: 0.8 }],
    });
    const crew = engine.createCrew({
      name: 'C1',
      agents: [],
      tasks: [{ id: 't1', title: 'T1', description: 'd', requiredCapabilities: ['general'] }],
      executionMode: 'sequential',
    });
    // 直接标记为 running 后取消
    (engine.getCrew(crew.id) as any).status = 'running';
    expect(engine.cancelCrew(crew.id, 'test')).toBe(true);
    expect(engine.getCrew(crew.id)?.status).toBe('cancelled');
  });

  it('listCrews', () => {
    const c1 = engine.createCrew({ name: 'C1', agents: [], tasks: [], executionMode: 'sequential' });
    const c2 = engine.createCrew({ name: 'C2', agents: [], tasks: [], executionMode: 'parallel' });
    expect(engine.listCrews().length).toBe(2);
    expect(engine.listCrews({ status: 'idle' }).length).toBe(2);
    void c1;
    void c2;
  });

  it('getMessageBus', () => {
    const bus = engine.getMessageBus();
    expect(bus).toBeInstanceOf(MessageBus);
  });

  it('getTaskResult', async () => {
    engine.registerAgent({
      id: 'w1',
      name: 'W1',
      role: 'worker',
      capabilities: [{ name: 'general', proficiency: 0.8 }],
    });
    const crew = engine.createCrew({
      name: 'C1',
      agents: [],
      tasks: [{ id: 't1', title: 'T1', description: 'd', requiredCapabilities: ['general'] }],
      executionMode: 'sequential',
    });
    await engine.executeCrew(crew.id);
    const r = engine.getTaskResult(crew.id, 't1');
    expect(r).toBeDefined();
    expect(r?.status).toBe('completed');
  });
});

describe('ManagerAgent 能力匹配', () => {
  it('Worker 选择：按能力匹配分数', () => {
    const engine = createMultiAgentEngine({ llmProvider: async () => 'ok' });
    engine.registerAgent({
      id: 'mgr',
      name: 'M',
      role: 'manager',
      capabilities: [],
    });
    const manager = (engine as any).manager as ManagerAgent;

    engine.registerAgent({
      id: 'w-best',
      name: 'Best',
      role: 'worker',
      capabilities: [{ name: 'code', proficiency: 0.95 }],
    });
    engine.registerAgent({
      id: 'w-med',
      name: 'Med',
      role: 'worker',
      capabilities: [{ name: 'code', proficiency: 0.5 }],
    });

    const task: TaskDefinition = {
      id: 't1',
      title: 'Code',
      description: 'd',
      requiredCapabilities: ['code'],
    };
    const workers = Array.from((engine as any).workers.values()) as WorkerAgent[];
    const selected = manager.selectWorker(task, workers);
    expect(selected?.getDefinition().id).toBe('w-best');
  });

  it('无可用 worker 返回 null', () => {
    const engine = createMultiAgentEngine({ llmProvider: async () => 'ok' });
    engine.registerAgent({
      id: 'mgr',
      name: 'M',
      role: 'manager',
      capabilities: [],
    });
    const manager = (engine as any).manager as ManagerAgent;
    const selected = manager.selectWorker(
      { id: 't1', title: 'T1', description: 'd', requiredCapabilities: [] },
      [],
    );
    expect(selected).toBeNull();
  });
});

describe('全局单例', () => {
  it('getDefaultMultiAgentEngine', () => {
    resetDefaultMultiAgentEngine();
    const e1 = getDefaultMultiAgentEngine();
    const e2 = getDefaultMultiAgentEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefaultMultiAgentEngine', () => {
    const e1 = getDefaultMultiAgentEngine();
    resetDefaultMultiAgentEngine();
    const e2 = getDefaultMultiAgentEngine();
    expect(e1).not.toBe(e2);
  });
});
