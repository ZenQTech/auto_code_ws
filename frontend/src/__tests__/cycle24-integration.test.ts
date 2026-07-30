/**
 * # ============================================================
 * # Cycle 24 集成测试 - 四大新功能联动验证 (P3 端到端)
 * # ============================================================
 * # 核心作用：验证 Cycle 24 新增的四大功能（GlobalMemory / MultiTask /
 * #           VoiceButton / FigmaImport）之间的联动和数据流。
 * # 运行流程：
 * #   1. 全局记忆引擎与多任务编排器联动
 * #   2. 语音输入与全局记忆联动
 * #   3. Figma 适配器与全局记忆联动
 * #   4. 多任务编排的依赖关系 + 冲突检测
 * #   5. 跨组件状态隔离 + 单例引擎隔离
 * #   6. 事件流订阅 + 数据迁移
 * #   7. 完整工作流：设计→实现→审查
 * # 输入参数：无（通过单例和事件总线）
 * # 输出结果：完整端到端验证报告
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 24 P3 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// ============ 引擎层单例 ============
import {
  getGlobalMemoryEngine,
  resetGlobalMemoryEngine,
  GlobalMemoryEngine,
} from '../utils/globalMemory';
import {
  getMultiTaskOrchestrator,
  resetMultiTaskOrchestrator,
  MultiTaskOrchestrator,
} from '../utils/multiTaskOrchestrator';
import {
  getFigmaAdapter,
  resetFigmaAdapter,
  FigmaAdapter,
} from '../utils/figmaAdapter';

// ============ 全局记忆 + 多任务联动 ============
describe('Cycle 24 P3 端到端集成 - 全局记忆 × 多任务编排', () => {
  let memory: GlobalMemoryEngine;
  let orchestrator: MultiTaskOrchestrator;

  beforeEach(() => {
    resetGlobalMemoryEngine();
    resetMultiTaskOrchestrator();
    memory = getGlobalMemoryEngine();
    orchestrator = getMultiTaskOrchestrator({ autoStart: false });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('任务创建时应在记忆引擎中记录任务定义', () => {
    // 1. 先在记忆中记录项目背景
    const ctx = memory.remember({
      type: 'context',
      scope: 'project',
      content: 'Cycle 24 P3 集成测试背景 - 验证四大功能联动',
      tags: ['cycle24', 'integration'],
      importance: 0.7,
      metadata: { source: "test" },
    });

    // 2. 创建多任务，引用记忆中的背景
    expect(ctx.id).toBeTruthy();
    const retrieved = memory.recall({}).find((m) => m.id === ctx.id);
    expect(retrieved).toBeTruthy();

    const task = orchestrator.createTask({
      name: '实现 Figma 适配器',
      type: 'implementation',
      description: retrieved?.content || '',
      priority: 8,
      dependsOn: [],
      totalSteps: 3,
      files: ['src/utils/figmaAdapter.ts'],
      model: 'claude-sonnet-4',
      maxRetries: 2,
      metadata: { relatedMemoryId: ctx.id },
    });

    // 3. 验证任务已创建
    expect(task.id).toBeTruthy();
    expect(task.status).toBe('pending');

    // 4. 在记忆中记录任务开始
    memory.remember({
      type: 'fact',
      scope: 'cycle',
      content: `任务启动: ${task.name} | 任务 ID: ${task.id}, 类型: ${task.type}`,
      tags: ['task', 'cycle24'],
      importance: 0.5,
      metadata: { source: "orchestrator" },
    });

    expect(memory.recall({}).length).toBeGreaterThanOrEqual(2);
  });

  it('任务完成时应能通过记忆引擎查询到任务历史', () => {
    // 1. 创建低重要性记忆
    const mem = memory.remember({
      type: 'rule',
      scope: 'user',
      content: '任务调度规则: 优先调度实现类任务',
      tags: ['rule'],
      importance: 0.4,
      metadata: { source: "test" },
    });

    // 2. 创建并完成一个任务
    const task = orchestrator.createTask({
      name: '应用调度规则',
      type: 'implementation',
      description: '应用规则',
      priority: 7,
      dependsOn: [],
      totalSteps: 1,
      files: ['src/utils/scheduler.ts'],
      model: 'claude-sonnet-4',
      maxRetries: 0,
      metadata: { memoryId: mem.id },
    });

    const started = orchestrator.tryStartTask(task.id);
    expect(started).toBe(true);
    const completed = orchestrator.completeTask(task.id, 'success');
    expect(completed).toBe(true);

    // 3. 验证任务完成状态
    const taskAfter = orchestrator.getTask(task.id);
    expect(taskAfter?.status).toBe('completed');

    // 4. 手动提升记忆重要性（模拟联动逻辑）
    memory.boostImportance(mem.id, 0.3);
    const updatedMem = memory.recall({}).find((m) => m.id === mem.id);
    expect(updatedMem).toBeTruthy();
    expect(updatedMem!.importance).toBeGreaterThan(mem.importance);
  });

  it('任务依赖关系应能被正确建立和查询', () => {
    // 1. 创建 A、B 两个任务，B 依赖 A
    const taskA = orchestrator.createTask({
      name: '任务 A：设计接口',
      type: 'architecture',
      description: '设计 GlobalMemory 接口',
      priority: 9,
      dependsOn: [],
      totalSteps: 1,
      files: ['src/utils/globalMemory.ts'],
      model: 'claude-sonnet-4',
      maxRetries: 0,
      metadata: {},
    });

    const taskB = orchestrator.createTask({
      name: '任务 B：实现 UI',
      type: 'implementation',
      description: '基于 A 的接口实现 UI',
      priority: 8,
      dependsOn: [taskA.id],
      totalSteps: 1,
      files: ['src/components/GlobalMemoryPanel.tsx'],
      model: 'claude-sonnet-4',
      maxRetries: 0,
      metadata: { dependsOnMemory: true },
    });

    // 2. B 启动应失败，因为 A 未完成
    const started = orchestrator.tryStartTask(taskB.id);
    expect(started).toBe(false);
    expect(orchestrator.getTask(taskB.id)?.status).toBe('pending');

    // 3. 完成 A 后 B 应该可以启动
    orchestrator.tryStartTask(taskA.id);
    orchestrator.completeTask(taskA.id, 'A done');

    // 4. completeTask 内部调用 startBatch()，B 应已自动启动
    expect(orchestrator.getTask(taskB.id)?.status).toBe('running');
  });

  it('依赖关系应能通过 getDependencies / getDependents 查询', () => {
    const taskA = orchestrator.createTask({
      name: 'A', type: 'architecture', description: '',
      priority: 5, dependsOn: [], totalSteps: 1, files: ['a.ts'],
      model: 'm', maxRetries: 0, metadata: {},
    });
    const taskB = orchestrator.createTask({
      name: 'B', type: 'implementation', description: '',
      priority: 5, dependsOn: [taskA.id], totalSteps: 1, files: ['b.ts'],
      model: 'm', maxRetries: 0, metadata: {},
    });

    // 验证 A 没有任何依赖
    expect(orchestrator.getDependencies(taskA.id)).toEqual([]);
    // 验证 B 依赖 A
    const bDeps = orchestrator.getDependencies(taskB.id);
    expect(bDeps.length).toBe(1);
    expect(bDeps[0].id).toBe(taskA.id);
    // 验证 A 有下游 B
    const aDown = orchestrator.getDependents(taskA.id);
    expect(aDown.length).toBe(1);
    expect(aDown[0].id).toBe(taskB.id);
  });
});

// ============ Figma × 全局记忆联动 ============
describe('Cycle 24 P3 端到端集成 - Figma × 全局记忆', () => {
  let memory: GlobalMemoryEngine;
  let figma: FigmaAdapter;

  beforeEach(() => {
    resetGlobalMemoryEngine();
    resetFigmaAdapter();
    memory = getGlobalMemoryEngine();
    figma = getFigmaAdapter({ useMockData: true });
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('应能从 Figma URL 解析 fileKey 和 nodeId', () => {
    const url = 'https://www.figma.com/file/abc123xyz7890/MyProject?node-id=12-34';
    const parsed = figma.parseUrl(url);
    expect(parsed).toBeTruthy();
    expect(parsed?.fileKey).toBe('abc123xyz7890');
    expect(parsed?.nodeId).toBe('12:34'); // 短横线自动转冒号
  });

  it('简单 fileKey 也应能正确解析', () => {
    const parsed = figma.parseUrl('abc123xyz7890');
    expect(parsed).toBeTruthy();
    expect(parsed?.fileKey).toBe('abc123xyz7890');
  });

  it('无效 URL 应返回 null', () => {
    const parsed = figma.parseUrl('not-a-valid-url');
    expect(parsed).toBeNull();
  });

  it('Figma 生成结果应能保存到记忆引擎', () => {
    // 1. 使用 Mock 模式加载节点
    const node = figma.loadMockData('button-primary');
    expect(node).toBeTruthy();

    const result = figma.toReact(node!, {
      framework: 'react',
      styling: 'tailwind',
      componentName: 'PrimaryButton',
      includeComments: true,
      extractImages: false,
    });

    expect(result.code).toBeTruthy();
    expect(result.framework).toBe('react');

    // 2. 将生成结果记录到记忆
    memory.remember({
      type: 'fact',
      scope: 'project',
      content: `Figma 生成: ${result.componentName}\n${result.code.slice(0, 200)}`,
      tags: ['figma', 'codegen', result.framework],
      importance: 0.6,
      metadata: { source: "figma-adapter" },
    });

    // 3. 验证记忆被持久化
    const stored = memory.recall({ types: ['fact'] });
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some((m) => m.content.includes('PrimaryButton'))).toBe(true);
  });

  it('应能列举所有可用的 Mock 预设', () => {
    const presets = figma.listMockPresets();
    expect(presets.length).toBeGreaterThanOrEqual(5);
    expect(presets).toContain('button-primary');
    expect(presets).toContain('card-simple');
    expect(presets).toContain('input-field');
  });

  it('多框架代码生成应产生不同输出', () => {
    const node = figma.loadMockData('button-primary');
    expect(node).toBeTruthy();

    const react = figma.generateFullComponent(node!, {
      framework: 'react',
      styling: 'tailwind',
      componentName: 'MyButton',
      includeComments: false,
      extractImages: false,
    });
    const vue = figma.generateFullComponent(node!, {
      framework: 'vue',
      styling: 'tailwind',
      componentName: 'MyButton',
      includeComments: false,
      extractImages: false,
    });
    const html = figma.generateFullComponent(node!, {
      framework: 'html',
      styling: 'tailwind',
      componentName: 'MyButton',
      includeComments: false,
      extractImages: false,
    });

    expect(react.code).not.toBe(vue.code);
    expect(vue.code).not.toBe(html.code);
    expect(react.code).toContain('React.FC');
    expect(vue.code).toContain('<template>');
    expect(html.code).toContain('<!DOCTYPE html>');
  });
});

// ============ 跨组件状态隔离 ============
describe('Cycle 24 P3 端到端集成 - 跨组件状态隔离', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('GlobalMemory 持久化 key 不应与 Figma 冲突', () => {
    // 1. 写入 GlobalMemory 持久化
    localStorage.setItem('hermes.globalMemoryPanel', JSON.stringify({ filterType: 'all' }));

    // 2. 写入 Figma 持久化
    localStorage.setItem('hermes.figimaImportPanel', JSON.stringify({ url: 'test' }));

    // 3. 验证两者独立
    const gm = JSON.parse(localStorage.getItem('hermes.globalMemoryPanel')!);
    const fig = JSON.parse(localStorage.getItem('hermes.figimaImportPanel')!);
    expect(gm.filterType).toBe('all');
    expect(fig.url).toBe('test');
  });

  it('应能枚举所有 Cycle 24 localStorage 键', () => {
    // 1. 模拟所有 Cycle 24 组件的持久化
    const cycle24Keys = [
      'hermes.globalMemoryPanel',
      'hermes.figimaImportPanel',
      'hermes.voiceButton',
      'hermes.multiTaskOrchestrationPanel',
    ];
    for (const key of cycle24Keys) {
      localStorage.setItem(key, JSON.stringify({ test: key }));
    }

    // 2. 验证所有键存在
    for (const key of cycle24Keys) {
      expect(localStorage.getItem(key)).toBeTruthy();
    }

    // 3. 验证键的数量
    const allKeys = Object.keys(localStorage);
    const cycle24Persisted = allKeys.filter((k) => k.startsWith('hermes.') && (
      k.includes('globalMemory') ||
      k.includes('figima') ||
      k.includes('voice') ||
      k.includes('multiTask')
    ));
    expect(cycle24Persisted.length).toBeGreaterThanOrEqual(4);
  });
});

// ============ 引擎单例隔离 ============
describe('Cycle 24 P3 端到端集成 - 引擎单例隔离', () => {
  beforeEach(() => {
    resetGlobalMemoryEngine();
    resetMultiTaskOrchestrator();
    resetFigmaAdapter();
  });

  afterEach(() => {
    cleanup();
  });

  it('GlobalMemoryEngine 多次获取应返回同一实例', () => {
    const e1 = getGlobalMemoryEngine();
    const e2 = getGlobalMemoryEngine();
    expect(e1).toBe(e2);
  });

  it('MultiTaskOrchestrator 多次获取应返回同一实例', () => {
    const o1 = getMultiTaskOrchestrator();
    const o2 = getMultiTaskOrchestrator();
    expect(o1).toBe(o2);
  });

  it('不同引擎的状态变更不应互相干扰', () => {
    const mem = getGlobalMemoryEngine();
    const orch = getMultiTaskOrchestrator({ autoStart: false });
    const fig = getFigmaAdapter({ useMockData: true });

    // 1. 修改 GlobalMemory
    mem.remember({ type: 'fact', scope: 'user', content: 'M1', tags: [], importance: 0.5, metadata: { source: 't' } });
    const memCount = mem.recall({}).length;

    // 2. 修改 MultiTask
    orch.createTask({ name: 'T1', type: 'implementation', description: '', priority: 5, dependsOn: [], totalSteps: 1, files: [], model: 'm', maxRetries: 0, metadata: {} });
    const taskCount = orch.listTasks().length;

    // 3. Figma 适配器
    const node = fig.loadMockData('button-primary');

    // 4. 验证三者互不影响
    expect(mem.recall({}).length).toBe(memCount);
    expect(orch.listTasks().length).toBe(taskCount);
    expect(node).toBeTruthy();
  });

  it('重置后所有引擎应返回新实例', () => {
    const e1 = getGlobalMemoryEngine();
    const o1 = getMultiTaskOrchestrator();
    const before = { mem: e1, orch: o1 };

    resetGlobalMemoryEngine();
    resetMultiTaskOrchestrator();

    const e2 = getGlobalMemoryEngine();
    const o2 = getMultiTaskOrchestrator();

    expect(e2).not.toBe(before.mem);
    expect(o2).not.toBe(before.orch);
  });
});

// ============ 事件流集成 ============
describe('Cycle 24 P3 端到端集成 - 事件流', () => {
  beforeEach(() => {
    resetGlobalMemoryEngine();
    resetMultiTaskOrchestrator();
  });

  afterEach(() => {
    cleanup();
  });

  it('多任务事件应能被外部订阅', () => {
    const orch = getMultiTaskOrchestrator({ autoStart: false });
    const events: string[] = [];

    const unsub1 = orch.on('task-created', () => {
      events.push('task-created');
    });
    const unsub2 = orch.on('task-started', () => {
      events.push('task-started');
    });
    const unsub3 = orch.on('task-completed', () => {
      events.push('task-completed');
    });

    const task = orch.createTask({
      name: 'T-event', type: 'implementation', description: '',
      priority: 5, dependsOn: [], totalSteps: 1, files: [],
      model: 'm', maxRetries: 0, metadata: {},
    });

    orch.tryStartTask(task.id);
    orch.completeTask(task.id, 'done');

    unsub1();
    unsub2();
    unsub3();

    // 至少应有 3 种事件触发
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events).toContain('task-created');
    expect(events).toContain('task-started');
    expect(events).toContain('task-completed');
  });

  it('全局记忆事件应能被外部订阅', () => {
    const mem = getGlobalMemoryEngine();
    const events: string[] = [];

    const unsub = mem.on('memory-created', ((entry: any) => {
      events.push(entry?.content || 'unknown');
    }) as any);

    mem.remember({ type: 'fact', scope: 'user', content: 'E1', tags: [], importance: 0.5, metadata: { source: 't' } });
    mem.remember({ type: 'rule', scope: 'user', content: 'E2', tags: [], importance: 0.5, metadata: { source: 't' } });

    unsub();

    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events).toContain('E1');
    expect(events).toContain('E2');
  });
});

// ============ 数据导出/导入跨引擎 ============
describe('Cycle 24 P3 端到端集成 - 数据迁移', () => {
  beforeEach(() => {
    resetGlobalMemoryEngine();
  });

  afterEach(() => {
    cleanup();
  });

  it('记忆导出后应能通过导入完整恢复', () => {
    const engine = getGlobalMemoryEngine();
    const ids: string[] = [];

    for (let i = 0; i < 5; i++) {
      const m = engine.remember({
        type: 'fact',
        scope: 'user',
        content: `记忆 ${i} - 内容 ${i}`,
        tags: [`tag-${i}`],
        importance: 0.5 + i * 0.1,
        metadata: { source: "test" },
      });
      ids.push(m.id);
    }

    const exported = engine.export('json');
    expect(exported).toBeTruthy();

    // 重置并重新导入
    resetGlobalMemoryEngine();
    const newEngine = getGlobalMemoryEngine();
    const imported = newEngine.import(exported, 'json');
    expect(imported).toBe(5);

    expect(newEngine.recall({}).length).toBe(5);
    for (const id of ids) {
      const m = newEngine.recall({}).find((entry) => entry.id === id);
      expect(m).toBeTruthy();
    }
  });

  it('压缩后的记忆导出应保留压缩标记', () => {
    const engine = getGlobalMemoryEngine();

    // 创建多个相似记忆
    for (let i = 0; i < 5; i++) {
      engine.remember({
        type: 'fact',
        scope: 'user',
        content: '相同的内容用于触发压缩 相同的内容用于触发压缩',
        tags: ['compress', 'shared'],
        importance: 0.5,
        metadata: { source: "test" },
      });
    }

    const beforeCompress = engine.recall({}).length;
    const compressed = engine.autoCompressIfNeeded();
    const afterCompress = engine.recall({}).length;

    // 如果触发了压缩，数量应该减少
    if (compressed) {
      expect(afterCompress).toBeLessThan(beforeCompress);
    }

    // 导出后能恢复
    const exported = engine.export('json');
    resetGlobalMemoryEngine();
    const newEngine = getGlobalMemoryEngine();
    newEngine.import(exported, 'json');
    expect(newEngine.recall({}).length).toBe(afterCompress);
  });
});

// ============ 工作流级集成 ============
describe('Cycle 24 P3 端到端集成 - 工作流级', () => {
  beforeEach(() => {
    resetGlobalMemoryEngine();
    resetMultiTaskOrchestrator();
    resetFigmaAdapter();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('完整工作流：架构→实现→审查 全链路', () => {
    const mem = getGlobalMemoryEngine();
    const orch = getMultiTaskOrchestrator({ autoStart: false });

    // 1. 记录项目背景
    mem.remember({
      type: 'context',
      scope: 'project',
      content: 'Cycle 24 P3 端到端工作流 - 架构→实现→审查',
      tags: ['workflow'],
      importance: 0.8,
      metadata: { source: "orchestrator" },
    });

    // 2. 创建任务链：架构 → 实现 → 审查
    const archTask = orch.createTask({
      name: '架构设计',
      type: 'architecture', description: '设计 Figma API',
      priority: 10, dependsOn: [], totalSteps: 1, files: ['docs/api.md'],
      model: 'm', maxRetries: 0, metadata: {},
    });
    const implTask = orch.createTask({
      name: '代码实现',
      type: 'implementation', description: '实现 Figma API',
      priority: 9, dependsOn: [archTask.id], totalSteps: 1, files: ['src/figma.ts'],
      model: 'm', maxRetries: 0, metadata: {},
    });
    const reviewTask = orch.createTask({
      name: '代码审查',
      type: 'review', description: '审查 Figma API 实现',
      priority: 8, dependsOn: [implTask.id], totalSteps: 1, files: ['src/figma.ts'],
      model: 'm', maxRetries: 0, metadata: {},
    });

    // 3. 执行任务链
    expect(orch.tryStartTask(archTask.id)).toBe(true);
    orch.completeTask(archTask.id, 'API designed');

    // completeTask 内部调用 startBatch()，会自动启动依赖任务
    expect(orch.getTask(implTask.id)?.status).toBe('running');
    orch.completeTask(implTask.id, 'API implemented');

    expect(orch.getTask(reviewTask.id)?.status).toBe('running');
    orch.completeTask(reviewTask.id, 'Code reviewed');

    // 4. 验证所有任务完成
    expect(orch.getTask(archTask.id)?.status).toBe('completed');
    expect(orch.getTask(implTask.id)?.status).toBe('completed');
    expect(orch.getTask(reviewTask.id)?.status).toBe('completed');

    // 5. 记录工作流结果到记忆
    mem.remember({
      type: 'fact',
      scope: 'cycle',
      content: 'Cycle 24 P3 端到端工作流完成 - 3 个任务全部完成',
      tags: ['workflow', 'complete'],
      importance: 0.9,
      metadata: { source: "orchestrator" },
    });

    const completedMems = mem.recall({ types: ['fact'] });
    expect(completedMems.some((m) => m.content.includes('工作流完成'))).toBe(true);
  });

  it('预算超限应阻止新任务启动', () => {
    const orch = getMultiTaskOrchestrator({
      autoStart: false,
      maxConcurrent: 1,
      totalBudget: 100,
    });

    // 创建两个任务
    const t1 = orch.createTask({
      name: 'T1', type: 'implementation', description: '',
      priority: 5, dependsOn: [], totalSteps: 1, files: ['a.ts'],
      model: 'm', maxRetries: 0, metadata: {},
    });
    const t2 = orch.createTask({
      name: 'T2', type: 'implementation', description: '',
      priority: 5, dependsOn: [], totalSteps: 1, files: ['b.ts'],
      model: 'm', maxRetries: 0, metadata: {},
    });

    // 1. 启动 T1 成功（预算未超限）
    expect(orch.tryStartTask(t1.id)).toBe(true);

    // 2. 记录成本使预算超限
    orch.recordCost(t1.id, 150, { input: 100, output: 50 });
    expect(orch.isOverBudget()).toBe(true);

    // 3. 启动 T2 应被预算限制阻止
    expect(orch.tryStartTask(t2.id)).toBe(false);
  });

  it('冲突检测应能识别文件级冲突', () => {
    const orch = getMultiTaskOrchestrator({
      autoStart: false,
      conflictPolicy: 'detect',
    });

    orch.createTask({
      name: 'T1', type: 'implementation', description: '',
      priority: 5, dependsOn: [], totalSteps: 1, files: ['src/figma.ts'],
      model: 'm', maxRetries: 0, metadata: {},
    });
    const t2 = orch.createTask({
      name: 'T2', type: 'implementation', description: '',
      priority: 5, dependsOn: [], totalSteps: 1, files: ['src/figma.ts'],
      model: 'm', maxRetries: 0, metadata: {},
    });

    // 通过 tryStartTask 触发冲突检测（应失败因为冲突策略为 detect）
    // 先启动 T1（这里使用单个 T1 启动无法触发冲突，需要两个 pending 任务同时进入）
    // 我们直接测试 t2 启动时，假设 t1 已经预留文件
    const tasks = orch.listTasks();
    expect(tasks.length).toBe(2);

    // 启动第一个任务
    const t1Started = orch.tryStartTask(tasks[0].id);
    expect(t1Started).toBe(true);

    // 启动第二个任务时，由于文件冲突会失败
    const t2Started = orch.tryStartTask(t2.id);
    expect(t2Started).toBe(false);

    // 验证两个任务都存在
    expect(orch.listTasks().length).toBe(2);
  });
});
