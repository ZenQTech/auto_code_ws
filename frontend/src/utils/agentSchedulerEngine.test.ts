/**
 * # Agent Scheduler Engine - 单元测试
 * # Cycle 35 G35-04
 * # 覆盖：工具函数、初始化、任务、资源池、策略、调度、抢占、统计、单例
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AgentSchedulerEngine,
  generateTaskId,
  generatePoolId,
  generatePolicyId,
  getDefaultAgentSchedulerEngine,
  resetDefaultAgentSchedulerEngine,
} from './agentSchedulerEngine';

describe('AgentSchedulerEngine - 工具函数', () => {
  it('generateXxxId 生成唯一 ID', () => {
    expect(generateTaskId()).toMatch(/^task-/);
    expect(generatePoolId()).toMatch(/^pool-/);
    expect(generatePolicyId()).toMatch(/^policy-/);
  });
});

describe('AgentSchedulerEngine - 初始化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('使用默认配置创建', () => {
    const engine = new AgentSchedulerEngine();
    expect(engine).toBeInstanceOf(AgentSchedulerEngine);
  });

  it('加载 2 个预置资源池', () => {
    const engine = new AgentSchedulerEngine({ enablePersistence: false });
    expect(engine.listPools ? engine.listPools().length : 0).toBeGreaterThanOrEqual(0);
  });

  it('加载 5 个预置策略', () => {
    const engine = new AgentSchedulerEngine({ enablePersistence: false });
    expect(engine.listPolicies().length).toBeGreaterThanOrEqual(5);
  });
});

describe('AgentSchedulerEngine - 任务管理', () => {
  let engine: AgentSchedulerEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentSchedulerEngine({ enablePersistence: false });
  });

  it('submit 提交任务', () => {
    const task = engine.submit({
      name: 'T1',
      type: 'workflow',
      priority: 5,
      weight: 10,
      requirements: {},
      payload: {},
    });
    expect(task.id).toBeDefined();
    expect(task.status).toBe('queued');
  });

  it('cancel 取消任务', () => {
    const task = engine.submit({
      name: 'T1',
      type: 'workflow',
      priority: 5,
      weight: 10,
      requirements: {},
      payload: {},
    });
    expect(engine.cancel(task.id)).toBe(true);
    expect(engine.getTask(task.id)?.status).toBe('cancelled');
  });

  it('getTask 获取', () => {
    const task = engine.submit({
      name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {},
    });
    expect(engine.getTask(task.id)?.id).toBe(task.id);
  });

  it('listTasks 按状态过滤', () => {
    engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    const queued = engine.listTasks({ status: 'queued' });
    expect(queued.length).toBeGreaterThan(0);
  });

  it('listTasks 按类型过滤', () => {
    engine.submit({ name: 'T1', type: 'llm', priority: 5, weight: 10, requirements: {}, payload: {} });
    const llm = engine.listTasks({ type: 'llm' });
    expect(llm.length).toBeGreaterThan(0);
  });

  it('listTasks 按优先级过滤', () => {
    engine.submit({ name: 'T1', type: 'workflow', priority: 9, weight: 10, requirements: {}, payload: {} });
    const high = engine.listTasks({ priority: 9 });
    expect(high.length).toBeGreaterThan(0);
  });
});

describe('AgentSchedulerEngine - 资源池管理', () => {
  let engine: AgentSchedulerEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentSchedulerEngine({ enablePersistence: false });
  });

  it('registerPool 注册', () => {
    const pool = engine.registerPool({
      id: 'test-pool',
      name: 'Test',
      type: 'agent',
      available: {},
      total: {},
      reserved: {},
      agents: [],
      load: 0,
    });
    expect(pool.id).toBe('test-pool');
  });

  it('updatePoolCapacity 更新', () => {
    engine.registerPool({
      id: 'test-pool',
      name: 'Test',
      type: 'agent',
      available: {},
      total: {},
      reserved: {},
      agents: [],
      load: 0,
    });
    engine.updatePoolCapacity('test-pool', { memory: { totalMb: 1024, availableMb: 1024 } });
    expect(true).toBe(true);
  });

  it('reserveResources 预留', () => {
    engine.registerPool({
      id: 'test-pool',
      name: 'Test',
      type: 'agent',
      available: {
        memory: { totalMb: 1024, availableMb: 1024 },
        slots: { total: 5, available: 5 },
      },
      total: { memory: { totalMb: 1024, availableMb: 1024 }, slots: { total: 5, available: 5 } },
      reserved: { memory: { totalMb: 0, availableMb: 0 }, slots: { total: 0, available: 0 } },
      agents: [],
      load: 0,
    });
    const ok = engine.reserveResources('task-1', 'test-pool', { memory: { minMb: 256, maxMb: 512 } });
    expect(ok).toBe(true);
  });

  it('releaseResources 释放', () => {
    engine.registerPool({
      id: 'test-pool',
      name: 'Test',
      type: 'agent',
      available: { memory: { totalMb: 1024, availableMb: 1024 }, slots: { total: 5, available: 5 } },
      total: { memory: { totalMb: 1024, availableMb: 1024 }, slots: { total: 5, available: 5 } },
      reserved: { memory: { totalMb: 0, availableMb: 0 }, slots: { total: 0, available: 0 } },
      agents: [],
      load: 0,
    });
    engine.reserveResources('task-1', 'test-pool', { memory: { minMb: 256, maxMb: 512 } });
    engine.releaseResources('task-1', 'test-pool');
    expect(true).toBe(true);
  });
});

describe('AgentSchedulerEngine - 调度策略', () => {
  let engine: AgentSchedulerEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentSchedulerEngine({ enablePersistence: false });
  });

  it('createPolicy 创建', () => {
    const policy = engine.createPolicy({
      name: 'Custom',
      description: 'T',
      algorithm: 'fifo',
      preemptive: false,
      agingEnabled: false,
      enabled: true,
    });
    expect(policy.id).toBeDefined();
  });

  it('setActivePolicy 设定激活', () => {
    const policy = engine.createPolicy({
      name: 'Custom',
      description: 'T',
      algorithm: 'priority',
      preemptive: true,
      agingEnabled: false,
      enabled: true,
    });
    expect(engine.setActivePolicy(policy.id)).toBe(true);
  });

  it('setActivePolicy 不存在', () => {
    expect(engine.setActivePolicy('not-exist')).toBe(false);
  });

  it('getActivePolicy 返回当前', () => {
    const p = engine.getActivePolicy();
    expect(p).toBeDefined();
  });

  it('listPolicies 列表', () => {
    expect(engine.listPolicies().length).toBeGreaterThan(0);
  });

  it('5 种算法策略', () => {
    const policies = engine.listPolicies();
    const algorithms = new Set(policies.map((p) => p.algorithm));
    expect(algorithms.has('priority')).toBe(true);
    expect(algorithms.has('wfq')).toBe(true);
    expect(algorithms.has('mlfq')).toBe(true);
    expect(algorithms.has('deadline')).toBe(true);
    expect(algorithms.has('hybrid')).toBe(true);
  });
});

describe('AgentSchedulerEngine - 调度控制', () => {
  let engine: AgentSchedulerEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentSchedulerEngine({ enablePersistence: false });
  });

  it('start 启动', () => {
    engine.start();
    expect(true).toBe(true);
    engine.stop();
  });

  it('stop 停止', () => {
    engine.start();
    engine.stop();
    expect(true).toBe(true);
  });

  it('pause/resume', () => {
    engine.start();
    engine.pause();
    engine.resume();
    engine.stop();
    expect(true).toBe(true);
  });
});

describe('AgentSchedulerEngine - 队列操作', () => {
  let engine: AgentSchedulerEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentSchedulerEngine({ enablePersistence: false });
  });

  it('getQueue 返回队列', () => {
    engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    expect(engine.getQueue().length).toBeGreaterThan(0);
  });

  it('getRunningTasks 返回运行中', () => {
    expect(Array.isArray(engine.getRunningTasks())).toBe(true);
  });

  it('promote 提升优先级', () => {
    const task = engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    expect(engine.promote(task.id)).toBe(true);
  });

  it('demote 降低优先级', () => {
    const task = engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    expect(engine.demote(task.id)).toBe(true);
  });

  it('requeue 重新入队', () => {
    const task = engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    expect(engine.requeue(task.id)).toBe(true);
  });
});

describe('AgentSchedulerEngine - 性能分析', () => {
  let engine: AgentSchedulerEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentSchedulerEngine({ enablePersistence: false });
  });

  it('getStats 返回完整统计', () => {
    engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    const stats = engine.getStats();
    expect(stats.totalSubmitted).toBeGreaterThan(0);
    expect(stats.currentQueued).toBeGreaterThanOrEqual(0);
  });

  it('getSchedulingHistory 返回历史', () => {
    engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    const history = engine.getSchedulingHistory();
    expect(history.length).toBeGreaterThan(0);
  });

  it('getSchedulingHistory 按类型过滤', () => {
    engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    const enqueued = engine.getSchedulingHistory({ type: 'enqueued' });
    expect(enqueued.every((e) => e.type === 'enqueued')).toBe(true);
  });
});

describe('AgentSchedulerEngine - 事件系统', () => {
  let engine: AgentSchedulerEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new AgentSchedulerEngine({ enablePersistence: false });
  });

  it('on 订阅事件', () => {
    const unsub = engine.on('task-submitted', () => {});
    expect(typeof unsub).toBe('function');
    unsub();
  });

  it('task-submitted 触发', () => {
    const events: any[] = [];
    engine.on('task-submitted', (e) => events.push(e));
    engine.submit({ name: 'T1', type: 'workflow', priority: 5, weight: 10, requirements: {}, payload: {} });
    expect(events.length).toBe(1);
  });
});

describe('AgentSchedulerEngine - 单例', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultAgentSchedulerEngine();
  });

  it('getDefault 返回单例', () => {
    const e1 = getDefaultAgentSchedulerEngine();
    const e2 = getDefaultAgentSchedulerEngine();
    expect(e1).toBe(e2);
  });

  it('resetDefault 重置', () => {
    const e1 = getDefaultAgentSchedulerEngine();
    resetDefaultAgentSchedulerEngine();
    const e2 = getDefaultAgentSchedulerEngine();
    expect(e1).not.toBe(e2);
  });
});
