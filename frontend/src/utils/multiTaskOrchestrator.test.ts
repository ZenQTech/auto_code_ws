/**
 * # ============================================================
 * # MultiTaskOrchestrator 单元测试 (Cycle 24 G24-02)
 * # ============================================================
 * # 覆盖：创建/启动/暂停/恢复/取消/重试/进度/依赖/冲突/预算/事件
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MultiTaskOrchestrator,
  InMemoryStorage,
  LocalStorageOrchestratorStorage,
  OrchestratorEventBus,
  DEFAULT_MULTI_TASK_CONFIG,
  MULTI_TASK_TYPE_LABELS,
  MULTI_TASK_TYPE_RESOURCE_LEVELS,
  getMultiTaskOrchestrator,
  resetMultiTaskOrchestrator,
  type CreateMultiTaskInput,
  type MultiTask,
} from './multiTaskOrchestrator';

function makeInput(overrides: Partial<CreateMultiTaskInput> = {}): CreateMultiTaskInput {
  return {
    name: 'Test Task',
    type: 'implementation',
    description: 'A test task',
    priority: 5,
    dependsOn: [],
    totalSteps: 10,
    files: [],
    model: 'claude-sonnet-4-5',
    maxRetries: 2,
    metadata: {},
    estimatedDurationMs: 60000,
    worktreeId: undefined,
    branch: undefined,
    ...overrides,
  };
}

describe('MultiTaskOrchestrator - 构造与配置', () => {
  it('应使用默认配置构造', () => {
    const engine = new MultiTaskOrchestrator();
    const config = engine.getConfig();
    expect(config.maxConcurrent).toBe(DEFAULT_MULTI_TASK_CONFIG.maxConcurrent);
    expect(config.maxRetries).toBe(DEFAULT_MULTI_TASK_CONFIG.maxRetries);
    expect(config.conflictPolicy).toBe('detect');
    expect(config.autoStart).toBe(true);
  });

  it('应接受自定义配置', () => {
    const engine = new MultiTaskOrchestrator({ maxConcurrent: 10, totalBudget: 50 });
    expect(engine.getConfig().maxConcurrent).toBe(10);
    expect(engine.getConfig().totalBudget).toBe(50);
  });

  it('应能更新配置', () => {
    const engine = new MultiTaskOrchestrator();
    engine.updateConfig({ maxConcurrent: 8 });
    expect(engine.getConfig().maxConcurrent).toBe(8);
  });

  it('应触发 config-updated 事件', () => {
    const engine = new MultiTaskOrchestrator();
    const handler = vi.fn();
    engine.on('config-updated', handler);
    engine.updateConfig({ maxConcurrent: 7 });
    expect(handler).toHaveBeenCalled();
  });

  it('InMemoryStorage 应能保存与加载', () => {
    const storage = new InMemoryStorage();
    const task: MultiTask = {
      id: 't1',
      name: 'X',
      type: 'implementation',
      description: 'd',
      status: 'pending',
      priority: 5,
      dependsOn: [],
      blockedBy: [],
      progress: 0,
      totalSteps: 5,
      completedSteps: 0,
      costSoFar: 0,
      tokensConsumed: { input: 0, output: 0 },
      model: 'm',
      files: [],
      retryCount: 0,
      maxRetries: 2,
      metadata: {},
      createdAt: 1,
      updatedAt: 1,
    };
    storage.save([task]);
    const loaded = storage.load();
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe('t1');
    storage.clear();
    expect(storage.load().length).toBe(0);
  });
});

describe('MultiTaskOrchestrator - 任务创建', () => {
  let engine: MultiTaskOrchestrator;

  beforeEach(() => {
    engine = new MultiTaskOrchestrator({ autoStart: false });
  });

  it('应创建任务并分配 ID', () => {
    const task = engine.createTask(makeInput({ name: 'task-1' }));
    expect(task.id).toBeDefined();
    expect(task.name).toBe('task-1');
    expect(task.status).toBe('pending');
    expect(task.progress).toBe(0);
  });

  it('应使用默认模型当未指定时', () => {
    const task = engine.createTask(makeInput({ model: '' as any }));
    expect(task.model).toBe(DEFAULT_MULTI_TASK_CONFIG.defaultModel);
  });

  it('应使用任务指定模型', () => {
    const task = engine.createTask(makeInput({ model: 'gpt-4o' }));
    expect(task.model).toBe('gpt-4o');
  });

  it('应触发 task-created 事件', () => {
    const handler = vi.fn();
    engine.on('task-created', handler);
    engine.createTask(makeInput());
    expect(handler).toHaveBeenCalled();
  });

  it('应能批量创建任务', () => {
    const tasks = engine.createBatch([
      makeInput({ name: 'a' }),
      makeInput({ name: 'b' }),
      makeInput({ name: 'c' }),
    ]);
    expect(tasks.length).toBe(3);
    expect(tasks[0].name).toBe('a');
    expect(tasks[2].name).toBe('c');
  });
});

describe('MultiTaskOrchestrator - 任务查询', () => {
  let engine: MultiTaskOrchestrator;

  beforeEach(() => {
    engine = new MultiTaskOrchestrator({ autoStart: false });
    engine.createTask(makeInput({ name: 'impl-1', type: 'implementation', priority: 5 }));
    engine.createTask(makeInput({ name: 'test-1', type: 'testing', priority: 7 }));
    engine.createTask(makeInput({ name: 'doc-1', type: 'documentation', priority: 3 }));
  });

  it('应能按 ID 获取任务', () => {
    const task = engine.createTask(makeInput({ name: 'target' }));
    const found = engine.getTask(task.id);
    expect(found?.name).toBe('target');
  });

  it('不存在的 ID 应返回 null', () => {
    expect(engine.getTask('non-existent')).toBeNull();
  });

  it('应能列出所有任务（按优先级倒序）', () => {
    const tasks = engine.listTasks();
    expect(tasks.length).toBe(3);
    expect(tasks[0].priority).toBe(7);
  });

  it('应能按状态过滤', () => {
    const tasks = engine.listTasks({ status: 'pending' });
    expect(tasks.length).toBe(3);
  });

  it('应能按类型过滤', () => {
    const tasks = engine.listTasks({ type: 'testing' });
    expect(tasks.length).toBe(1);
  });

  it('应能按多类型过滤', () => {
    const tasks = engine.listTasks({ type: ['testing', 'documentation'] });
    expect(tasks.length).toBe(2);
  });

  it('应能按优先级区间过滤', () => {
    const tasks = engine.listTasks({ priority: { min: 4, max: 6 } });
    expect(tasks.length).toBe(1);
    expect(tasks[0].name).toBe('impl-1');
  });

  it('应能按名称模糊搜索', () => {
    const tasks = engine.listTasks({ name: 'test' });
    expect(tasks.length).toBe(1);
  });

  it('getReadyTasks 应返回所有 pending 任务（无依赖）', () => {
    const ready = engine.getReadyTasks();
    expect(ready.length).toBe(3);
  });

  it('getRunningTasks 应返回空（未启动）', () => {
    expect(engine.getRunningTasks().length).toBe(0);
  });

  it('应能删除任务', () => {
    const task = engine.createTask(makeInput({ name: 'to-delete' }));
    expect(engine.deleteTask(task.id)).toBe(true);
    expect(engine.getTask(task.id)).toBeNull();
  });

  it('删除不存在的任务应返回 false', () => {
    expect(engine.deleteTask('non-existent')).toBe(false);
  });

  it('删除任务应从其他任务依赖中移除', () => {
    const a = engine.createTask(makeInput({ name: 'a' }));
    const b = engine.createTask(makeInput({ name: 'b', dependsOn: [a.id] }));
    engine.deleteTask(a.id);
    expect(engine.getTask(b.id)?.dependsOn).not.toContain(a.id);
  });
});

describe('MultiTaskOrchestrator - 执行控制', () => {
  let engine: MultiTaskOrchestrator;

  beforeEach(() => {
    engine = new MultiTaskOrchestrator({ autoStart: false, maxConcurrent: 2 });
  });

  it('应能启动 pending 任务', () => {
    const task = engine.createTask(makeInput({ name: 'start-me' }));
    expect(engine.start(task.id)).toBe(true);
    expect(engine.getTask(task.id)?.status).toBe('running');
  });

  it('启动非 pending 任务应返回 false', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    expect(engine.start(task.id)).toBe(false);
  });

  it('应限制最大并发数', () => {
    engine.createTask(makeInput({ name: 'a' }));
    engine.createTask(makeInput({ name: 'b' }));
    engine.createTask(makeInput({ name: 'c' }));
    const started = engine.startBatch();
    expect(started).toBe(2);
    expect(engine.getRunningTasks().length).toBe(2);
  });

  it('应能暂停运行中的任务', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    expect(engine.pause(task.id)).toBe(true);
    expect(engine.getTask(task.id)?.status).toBe('paused');
  });

  it('应能恢复暂停的任务', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    engine.pause(task.id);
    expect(engine.resume(task.id)).toBe(true);
    expect(engine.getTask(task.id)?.status).toBe('running');
  });

  it('暂停非运行任务应返回 false', () => {
    const task = engine.createTask(makeInput());
    expect(engine.pause(task.id)).toBe(false);
  });

  it('应能取消任务', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    expect(engine.cancel(task.id)).toBe(true);
    expect(engine.getTask(task.id)?.status).toBe('cancelled');
  });

  it('取消已完成任务应返回 false', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    engine.completeTask(task.id, 'done');
    expect(engine.cancel(task.id)).toBe(false);
  });

  it('应能重试失败任务', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    engine.failTask(task.id, { code: 'X', message: 'failed' });
    expect(engine.retry(task.id)).toBe(true);
    expect(engine.getTask(task.id)?.status === 'pending' || engine.getTask(task.id)?.status === 'running').toBe(true);
    expect(engine.getTask(task.id)?.retryCount).toBe(1);
  });

  it('超过 maxRetries 后重试应失败', () => {
    const task = engine.createTask(makeInput({ maxRetries: 1 }));
    engine.start(task.id);
    engine.failTask(task.id, { code: 'X', message: 'failed' });
    engine.retry(task.id);
    engine.failTask(task.id, { code: 'X', message: 'failed' });
    expect(engine.retry(task.id)).toBe(false);
  });

  it('autoStart=true 时创建任务后自动启动', () => {
    const e = new MultiTaskOrchestrator({ autoStart: true });
    const task = e.createTask(makeInput());
    expect(task.status).toBe('running');
  });

  it('autoStart=true 但超过并发数时保持 pending', () => {
    const e = new MultiTaskOrchestrator({ autoStart: true, maxConcurrent: 1 });
    const t1 = e.createTask(makeInput());
    const t2 = e.createTask(makeInput());
    expect(t1.status).toBe('running');
    expect(t2.status).toBe('pending');
  });
});

describe('MultiTaskOrchestrator - 进度更新', () => {
  let engine: MultiTaskOrchestrator;

  beforeEach(() => {
    engine = new MultiTaskOrchestrator({ autoStart: false });
  });

  it('应能更新进度', () => {
    const task = engine.createTask(makeInput({ totalSteps: 10 }));
    engine.start(task.id);
    engine.updateProgress(task.id, 50, 'step-1');
    const updated = engine.getTask(task.id);
    expect(updated?.progress).toBe(50);
    expect(updated?.completedSteps).toBe(5);
    expect(updated?.currentStep).toBe('step-1');
  });

  it('应限制进度在 0-100', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    engine.updateProgress(task.id, 150);
    expect(engine.getTask(task.id)?.progress).toBe(100);
    engine.updateProgress(task.id, -10);
    expect(engine.getTask(task.id)?.progress).toBe(0);
  });

  it('应能记录成本', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    engine.recordCost(task.id, 0.5, { input: 100, output: 200 });
    engine.recordCost(task.id, 0.3, { input: 50, output: 100 });
    const updated = engine.getTask(task.id);
    expect(updated?.costSoFar).toBeCloseTo(0.8, 5);
    expect(updated?.tokensConsumed.input).toBe(150);
    expect(updated?.tokensConsumed.output).toBe(300);
  });

  it('应能完成任务', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    engine.completeTask(task.id, 'success');
    const updated = engine.getTask(task.id);
    expect(updated?.status).toBe('completed');
    expect(updated?.result).toBe('success');
    expect(updated?.progress).toBe(100);
  });

  it('完成任务应自动启动依赖任务', () => {
    const t1 = engine.createTask(makeInput({ name: 't1' }));
    const t2 = engine.createTask(makeInput({ name: 't2', dependsOn: [t1.id] }));
    engine.start(t1.id);
    engine.completeTask(t1.id, 'ok');
    // 由于 t2 依赖 t1，应自动启动
    expect(engine.getTask(t2.id)?.status).toBe('running');
  });

  it('应能标记任务失败', () => {
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    engine.failTask(task.id, { code: 'ERR', message: 'broken' });
    const updated = engine.getTask(task.id);
    expect(updated?.status).toBe('failed');
    expect(updated?.error?.code).toBe('ERR');
  });
});

describe('MultiTaskOrchestrator - 依赖管理', () => {
  let engine: MultiTaskOrchestrator;

  beforeEach(() => {
    engine = new MultiTaskOrchestrator({ autoStart: false });
  });

  it('resolveDependencies 应进行拓扑排序', () => {
    const a = engine.createTask(makeInput({ name: 'a' }));
    const b = engine.createTask(makeInput({ name: 'b', dependsOn: [a.id] }));
    engine.createTask(makeInput({ name: 'c', dependsOn: [b.id] }));
    const sorted = engine.resolveDependencies();
    const order = sorted.map((t) => t.name);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('getDependencies 应返回依赖任务', () => {
    const a = engine.createTask(makeInput({ name: 'a' }));
    const b = engine.createTask(makeInput({ name: 'b', dependsOn: [a.id] }));
    const deps = engine.getDependencies(b.id);
    expect(deps.length).toBe(1);
    expect(deps[0].id).toBe(a.id);
  });

  it('getDependents 应返回依赖此任务的任务', () => {
    const a = engine.createTask(makeInput({ name: 'a' }));
    const b = engine.createTask(makeInput({ name: 'b', dependsOn: [a.id] }));
    const dependents = engine.getDependents(a.id);
    expect(dependents.length).toBe(1);
    expect(dependents[0].id).toBe(b.id);
  });

  it('有未完成依赖的任务不应启动', () => {
    const a = engine.createTask(makeInput({ name: 'a' }));
    const b = engine.createTask(makeInput({ name: 'b', dependsOn: [a.id] }));
    expect(engine.start(b.id)).toBe(false);
  });

  it('依赖完成后下游任务可启动', () => {
    const a = engine.createTask(makeInput({ name: 'a' }));
    const b = engine.createTask(makeInput({ name: 'b', dependsOn: [a.id] }));
    engine.start(a.id);
    engine.completeTask(a.id, 'ok');
    // completeTask 自动启动依赖任务，所以 b 应该已经 running
    expect(engine.getTask(b.id)?.status).toBe('running');
  });
});

describe('MultiTaskOrchestrator - 冲突检测', () => {
  it('detectConflicts 应发现文件冲突', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    const a = engine.createTask(makeInput({ name: 'a', files: ['f1.ts', 'f2.ts'] }));
    const b = engine.createTask(makeInput({ name: 'b', files: ['f2.ts', 'f3.ts'] }));
    const conflicts = engine.detectConflicts([a, b]);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].files).toEqual(['f2.ts']);
  });

  it('无重叠文件应无冲突', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    const a = engine.createTask(makeInput({ name: 'a', files: ['f1.ts'] }));
    const b = engine.createTask(makeInput({ name: 'b', files: ['f2.ts'] }));
    expect(engine.detectConflicts([a, b]).length).toBe(0);
  });

  it('reserveFiles 应阻止其他任务启动', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false, conflictPolicy: 'detect' });
    const t1 = engine.createTask(makeInput({ name: 't1', files: ['shared.ts'] }));
    const t2 = engine.createTask(makeInput({ name: 't2', files: ['shared.ts'] }));
    engine.start(t1.id);
    // t1 已运行并预留 shared.ts，t2 不应能启动
    expect(engine.start(t2.id)).toBe(false);
  });

  it('releaseFiles 应释放文件', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    const task = engine.createTask(makeInput({ name: 't' }));
    engine.reserveFiles(task.id, ['x.ts']);
    engine.releaseFiles(task.id);
    expect(engine.reserveFiles(task.id, ['x.ts'])).toBe(true);
  });

  it('getConflicts/clearConflicts 应可用', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    expect(engine.getConflicts().length).toBe(0);
    const t1 = engine.createTask(makeInput({ name: 't1', files: ['f.ts'] }));
    const t2 = engine.createTask(makeInput({ name: 't2', files: ['f.ts'] }));
    engine.detectConflicts([t1, t2]);
    engine.clearConflicts();
    expect(engine.getConflicts().length).toBe(0);
  });
});

describe('MultiTaskOrchestrator - 预算控制', () => {
  it('应正确计算剩余预算', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false, totalBudget: 10 });
    const t = engine.createTask(makeInput());
    engine.start(t.id);
    engine.recordCost(t.id, 3, { input: 100, output: 50 });
    expect(engine.getRemainingBudget()).toBe(7);
  });

  it('超出总预算应暂停新任务', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false, totalBudget: 5 });
    const t1 = engine.createTask(makeInput({ name: 't1' }));
    engine.start(t1.id);
    engine.recordCost(t1.id, 5, { input: 0, output: 0 });
    const t2 = engine.createTask(makeInput({ name: 't2' }));
    expect(engine.start(t2.id)).toBe(false);
  });

  it('isTaskOverBudget 应能检测单任务超预算', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false, perTaskBudget: 1 });
    const t = engine.createTask(makeInput());
    engine.start(t.id);
    engine.recordCost(t.id, 0.5, { input: 0, output: 0 });
    expect(engine.isTaskOverBudget(t.id)).toBe(false);
    engine.recordCost(t.id, 0.6, { input: 0, output: 0 });
    expect(engine.isTaskOverBudget(t.id)).toBe(true);
  });

  it('应触发 budget-exceeded 事件', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false, totalBudget: 1 });
    const t = engine.createTask(makeInput());
    engine.start(t.id);
    const handler = vi.fn();
    engine.on('budget-exceeded', handler);
    engine.recordCost(t.id, 2, { input: 0, output: 0 });
    expect(handler).toHaveBeenCalled();
  });
});

describe('MultiTaskOrchestrator - 统计', () => {
  it('getStats 应返回正确统计', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    const t1 = engine.createTask(makeInput({ name: 't1' }));
    const t2 = engine.createTask(makeInput({ name: 't2' }));
    engine.start(t1.id);
    engine.recordCost(t1.id, 0.5, { input: 10, output: 20 });
    engine.completeTask(t2.id, 'instant');

    const stats = engine.getStats();
    expect(stats.totalTasks).toBe(2);
    expect(stats.runningTasks).toBe(1);
    expect(stats.completedTasks).toBe(1);
    expect(stats.totalCost).toBeCloseTo(0.5, 5);
    expect(stats.totalTokens.input).toBe(10);
    expect(stats.budgetUsage).toBeGreaterThan(0);
  });

  it('空引擎统计应为 0', () => {
    const engine = new MultiTaskOrchestrator();
    const stats = engine.getStats();
    expect(stats.totalTasks).toBe(0);
    expect(stats.runningTasks).toBe(0);
    expect(stats.totalCost).toBe(0);
  });
});

describe('MultiTaskOrchestrator - 事件总线', () => {
  it('应能订阅 task-progress 事件', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    const handler = vi.fn();
    engine.on('task-progress', handler);
    engine.updateProgress(task.id, 25, 'doing');
    expect(handler).toHaveBeenCalled();
  });

  it('应能取消订阅', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    const task = engine.createTask(makeInput());
    engine.start(task.id);
    const handler = vi.fn();
    const off = engine.on('task-progress', handler);
    off();
    engine.updateProgress(task.id, 30);
    expect(handler).not.toHaveBeenCalled();
  });

  it('OrchestratorEventBus 应独立工作', () => {
    const bus = new OrchestratorEventBus();
    const handler = vi.fn();
    bus.on('task-created', handler);
    bus.emit('task-created', { x: 1 });
    expect(handler).toHaveBeenCalledWith({ x: 1 });
    expect(bus.listenerCount('task-created')).toBe(1);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });
});

describe('MultiTaskOrchestrator - 资源等级', () => {
  it('所有任务类型应有资源等级', () => {
    const types: Array<keyof typeof MULTI_TASK_TYPE_RESOURCE_LEVELS> = [
      'requirement',
      'architecture',
      'implementation',
      'testing',
      'review',
      'documentation',
      'refactor',
      'deployment',
    ];
    for (const t of types) {
      expect(MULTI_TASK_TYPE_RESOURCE_LEVELS[t]).toBeDefined();
    }
  });

  it('所有任务类型应有标签', () => {
    const types = Object.keys(MULTI_TASK_TYPE_LABELS);
    expect(types.length).toBeGreaterThanOrEqual(8);
  });
});

describe('MultiTaskOrchestrator - 重置与单例', () => {
  it('reset 应清空所有任务', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    engine.createTask(makeInput());
    engine.createTask(makeInput());
    engine.reset();
    expect(engine.listTasks().length).toBe(0);
  });

  it('应能重置事件', () => {
    const engine = new MultiTaskOrchestrator({ autoStart: false });
    const handler = vi.fn();
    engine.on('engine-reset', handler);
    engine.reset();
    expect(handler).toHaveBeenCalled();
  });

  it('getMultiTaskOrchestrator 应返回单例', () => {
    resetMultiTaskOrchestrator();
    const a = getMultiTaskOrchestrator();
    const b = getMultiTaskOrchestrator();
    expect(a).toBe(b);
  });

  it('resetMultiTaskOrchestrator 应清除单例', () => {
    const a = getMultiTaskOrchestrator();
    resetMultiTaskOrchestrator();
    const b = getMultiTaskOrchestrator();
    expect(a).not.toBe(b);
  });
});

describe('LocalStorageOrchestratorStorage', () => {
  it('应在无 localStorage 时安全降级', () => {
    const storage = new LocalStorageOrchestratorStorage('test:mt');
    const task: MultiTask = {
      id: 'x',
      name: 'x',
      type: 'implementation',
      description: '',
      status: 'pending',
      priority: 5,
      dependsOn: [],
      blockedBy: [],
      progress: 0,
      totalSteps: 1,
      completedSteps: 0,
      costSoFar: 0,
      tokensConsumed: { input: 0, output: 0 },
      model: 'm',
      files: [],
      retryCount: 0,
      maxRetries: 0,
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
    };
    expect(() => storage.save([task])).not.toThrow();
    expect(storage.load().length).toBeGreaterThanOrEqual(0);
    expect(() => storage.clear()).not.toThrow();
  });
});
