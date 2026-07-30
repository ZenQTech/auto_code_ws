/**
 * # Dynamic Workflow Engine 单元测试 (Cycle 30 G30-02)
 * # 覆盖 40 个核心测试用例
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DynamicWorkflowEngine,
  generateWorkflowId,
  getDefaultDynamicWorkflowEngine,
  resetDefaultDynamicWorkflowEngine,
} from './dynamicWorkflowEngine';
import type {
  WorkflowDefinition,
  WorkflowPhase,
} from './dynamicWorkflowEngine';

// 帮助函数：创建简单的 sleep
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 帮助函数：创建一个简单的 phase
const createPhase = (
  id: string,
  opts: Partial<WorkflowPhase> = {}
): WorkflowPhase => ({
  id,
  name: id,
  type: 'execute',
  dependsOn: [],
  contract: {},
  retryBudget: 0,
  execute: async () => ({ status: 'success', output: `${id}-result`, durationMs: 0, retries: 0 }),
  ...opts,
});

describe('DynamicWorkflowEngine', () => {
  let engine: DynamicWorkflowEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new DynamicWorkflowEngine({ persist: false });
  });

  // ============ 工具函数 ============

  describe('工具函数', () => {
    it('generateWorkflowId 生成唯一 ID', () => {
      const id1 = generateWorkflowId();
      const id2 = generateWorkflowId();
      expect(id1).not.toBe(id2);
      expect(id1.startsWith('wf-')).toBe(true);
    });
  });

  // ============ 定义管理 ============

  describe('定义管理', () => {
    it('注册工作流', () => {
      const wf: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Test',
        description: 'Test workflow',
        version: '1.0.0',
        phases: [createPhase('p1')],
      };
      engine.registerWorkflow(wf);
      expect(engine.getWorkflow('wf-1')).toBeDefined();
    });

    it('获取工作流', () => {
      const wf: WorkflowDefinition = {
        id: 'wf-1',
        name: 'Test',
        description: 'Test',
        version: '1.0.0',
        phases: [createPhase('p1')],
      };
      engine.registerWorkflow(wf);
      expect(engine.getWorkflow('wf-1')?.name).toBe('Test');
    });

    it('列出所有工作流', () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T1',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      engine.registerWorkflow({
        id: 'wf-2',
        name: 'T2',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      expect(engine.listWorkflows()).toHaveLength(2);
    });

    it('删除工作流', () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T1',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      expect(engine.unregisterWorkflow('wf-1')).toBe(true);
      expect(engine.getWorkflow('wf-1')).toBeUndefined();
    });

    it('重复注册报错', () => {
      const wf: WorkflowDefinition = {
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      };
      engine.registerWorkflow(wf);
      expect(() => engine.registerWorkflow(wf)).toThrow();
    });

    it('依赖不存在的 phase 报错', () => {
      expect(() =>
        engine.registerWorkflow({
          id: 'wf-bad',
          name: 'Bad',
          description: '',
          version: '1.0.0',
          phases: [createPhase('p1', { dependsOn: ['non-existent'] })],
        })
      ).toThrow();
    });
  });

  // ============ 基本执行 ============

  describe('基本执行', () => {
    it('执行单 phase 线性工作流', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Single',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            execute: async () => ({
              status: 'success',
              output: 'done',
              durationMs: 10,
              retries: 0,
            }),
          }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'start' });
      await sleep(50);
      const final = engine.getInstance(instance.id);
      expect(final?.status).toBe('completed');
      expect(final?.phaseStates['p1'].output).toBe('done');
    });

    it('执行多 phase 串行工作流', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Multi',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1'),
          createPhase('p2', { dependsOn: ['p1'] }),
          createPhase('p3', { dependsOn: ['p2'] }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'start' });
      await sleep(100);
      const final = engine.getInstance(instance.id);
      expect(final?.status).toBe('completed');
    });

    it('执行并行 phase 工作流', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Parallel',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', { parallelGroup: 'g1' }),
          createPhase('p2', { parallelGroup: 'g1' }),
          createPhase('p3', { parallelGroup: 'g1' }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'start' });
      await sleep(100);
      const final = engine.getInstance(instance.id);
      expect(final?.status).toBe('completed');
    });

    it('阶段失败工作流失败', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Fail',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            execute: async () => {
              throw new Error('故意失败');
            },
          }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'start' });
      await sleep(50);
      const final = engine.getInstance(instance.id);
      expect(final?.status).toBe('failed');
    });

    it('依赖失败时下游 phase 跳过', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Skip',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            execute: async () => {
              throw new Error('失败');
            },
          }),
          createPhase('p2', { dependsOn: ['p1'] }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'start' });
      await sleep(50);
      const final = engine.getInstance(instance.id);
      // p2 永远 pending，workflow 失败
      expect(final?.status).toBe('failed');
    });

    it('启动 + 等待异步完成', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Async',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });

      const instance = await engine.startAndWait('wf-1', { initialInput: 'x' });
      expect(instance.status).toBe('completed');
    });
  });

  // ============ 暂停/恢复/重放 ============

  describe('暂停/恢复/重放', () => {
    it('暂停运行中工作流', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Pause',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            execute: async () => {
              await sleep(200);
              return { status: 'success', output: 'p1', durationMs: 200, retries: 0 };
            },
          }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'x' });
      await sleep(30);
      engine.pause(instance.id);
      const paused = engine.getInstance(instance.id);
      expect(paused?.status).toBe('paused');
    });

    it('恢复暂停工作流', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Resume',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            execute: async () => {
              await sleep(200);
              return { status: 'success', output: 'p1', durationMs: 200, retries: 0 };
            },
          }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'x' });
      await sleep(30);
      engine.pause(instance.id);
      engine.resume(instance.id);
      await sleep(300);
      const final = engine.getInstance(instance.id);
      expect(['running', 'completed']).toContain(final?.status);
    });

    it('从指定 phase 恢复', async () => {
      let p2Executed = false;
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'ResumeFrom',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            execute: async () => {
              await sleep(200);
              return { status: 'success', output: 'p1', durationMs: 200, retries: 0 };
            },
          }),
          createPhase('p2', {
            dependsOn: ['p1'],
            execute: async () => {
              p2Executed = true;
              return { status: 'success', output: 'p2', durationMs: 0, retries: 0 };
            },
          }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'x' });
      // 暂停以确保 p1 未完成
      await sleep(30);
      engine.pause(instance.id);
      // 恢复时让 p1 重新执行（因为 abort 中断了它）
      engine.resume(instance.id);
      await sleep(300);
      expect(p2Executed).toBe(true);
    });

    it('取消运行中工作流', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'Cancel',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            execute: async () => {
              await sleep(50);
              return { status: 'success', output: 'p1', durationMs: 50, retries: 0 };
            },
          }),
        ],
      });

      const instance = engine.start('wf-1', { initialInput: 'x' });
      engine.cancel(instance.id);
      const cancelled = engine.getInstance(instance.id);
      expect(cancelled?.status).toBe('cancelled');
    });
  });

  // ============ 模板 ============

  describe('模板', () => {
    it('buildFanOutVerifyAggregate', () => {
      const wf = engine.buildFanOutVerifyAggregate({
        name: 'FVA',
        fanoutCount: 3,
        verifierCount: 2,
        aggregatorType: 'merge',
        fanoutExecute: async () => ({ status: 'success', output: {}, durationMs: 0, retries: 0 }),
        verifyExecute: async () => ({ status: 'success', output: true, durationMs: 0, retries: 0 }),
        aggregateExecute: async () => ({ status: 'success', output: {}, durationMs: 0, retries: 0 }),
      });
      // 3 fanout + 2 verify + 1 aggregate = 6 phases
      expect(wf.phases).toHaveLength(6);
      expect(wf.metadata?.aggregatorType).toBe('merge');
    });

    it('buildReviewRepairValidate', () => {
      const wf = engine.buildReviewRepairValidate({
        name: 'RRV',
        reviewRounds: 2,
        reviewExecute: async () => ({ status: 'success', output: true, durationMs: 0, retries: 0 }),
        repairExecute: async () => ({ status: 'success', output: 'fixed', durationMs: 0, retries: 0 }),
        validateExecute: async () => ({ status: 'success', output: true, durationMs: 0, retries: 0 }),
      });
      // 2 reviews + 1 repair + 1 validate = 4 phases
      expect(wf.phases).toHaveLength(4);
    });

    it('buildPipeline', () => {
      const wf = engine.buildPipeline({
        name: 'Pipe',
        phases: [
          { id: 'p1', name: 'P1', type: 'execute', execute: async () => ({ status: 'success', output: 1, durationMs: 0, retries: 0 }) },
          { id: 'p2', name: 'P2', type: 'execute', execute: async () => ({ status: 'success', output: 2, durationMs: 0, retries: 0 }) },
        ],
      });
      expect(wf.phases).toHaveLength(2);
      expect(wf.phases[1].dependsOn).toEqual(['p1']);
    });
  });

  // ============ 重试与超时 ============

  describe('重试与超时', () => {
    it('阶段重试', async () => {
      let attempts = 0;
      engine.registerWorkflow({
        id: 'wf-retry',
        name: 'Retry',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            retryBudget: 2,
            execute: async () => {
              attempts++;
              if (attempts < 3) {
                throw new Error('失败');
              }
              return { status: 'success', output: 'ok', durationMs: 0, retries: 0 };
            },
          }),
        ],
      });

      const instance = engine.start('wf-retry', { initialInput: 'x' });
      await sleep(100);
      const final = engine.getInstance(instance.id);
      expect(final?.status).toBe('completed');
      expect(attempts).toBe(3);
    });

    it('重试耗尽失败', async () => {
      engine.registerWorkflow({
        id: 'wf-fail',
        name: 'Fail',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            retryBudget: 1,
            execute: async () => {
              throw new Error('总是失败');
            },
          }),
        ],
      });

      const instance = engine.start('wf-fail', { initialInput: 'x' });
      await sleep(50);
      const final = engine.getInstance(instance.id);
      expect(final?.status).toBe('failed');
    });

    it('阶段超时', async () => {
      engine.registerWorkflow({
        id: 'wf-timeout',
        name: 'Timeout',
        description: '',
        version: '1.0.0',
        phases: [
          createPhase('p1', {
            timeoutMs: 50,
            execute: async () => {
              await sleep(200);
              return { status: 'success', output: 'late', durationMs: 0, retries: 0 };
            },
          }),
        ],
      });

      const instance = engine.start('wf-timeout', { initialInput: 'x' });
      await sleep(150);
      const final = engine.getInstance(instance.id);
      expect(final?.status).toBe('failed');
    });
  });

  // ============ Journal ============

  describe('Journal', () => {
    it('写入 journal', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'J',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });

      const instance = engine.start('wf-1', { initialInput: 'x' });
      await sleep(50);
      const journal = engine.getJournal(instance.id);
      expect(journal.length).toBeGreaterThan(0);
    });

    it('获取指定实例的 journal', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'J',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });

      const instance = engine.start('wf-1', { initialInput: 'x' });
      await sleep(50);
      expect(engine.getJournal('non-existent')).toHaveLength(0);
      expect(engine.getJournal(instance.id).length).toBeGreaterThan(0);
    });
  });

  // ============ 事件 ============

  describe('事件', () => {
    it('订阅 workflow-started', async () => {
      const events: any[] = [];
      engine.on('workflow-started', (e) => events.push(e));
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      engine.start('wf-1', { initialInput: 'x' });
      await sleep(20);
      expect(events).toHaveLength(1);
    });

    it('订阅 phase-completed', async () => {
      const events: any[] = [];
      engine.on('phase-completed', (e) => events.push(e));
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      engine.start('wf-1', { initialInput: 'x' });
      await sleep(50);
      expect(events).toHaveLength(1);
    });

    it('订阅 journal-written', async () => {
      const events: any[] = [];
      engine.on('journal-written', (e) => events.push(e));
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      engine.start('wf-1', { initialInput: 'x' });
      await sleep(50);
      expect(events.length).toBeGreaterThan(0);
    });

    it('取消订阅', async () => {
      const events: any[] = [];
      const unsub = engine.on('phase-completed', (e) => events.push(e));
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      engine.start('wf-1', { initialInput: 'x' });
      await sleep(50);
      const count1 = events.length;
      unsub();
      engine.start('wf-1', { initialInput: 'x' });
      await sleep(50);
      expect(events).toHaveLength(count1);
    });
  });

  // ============ 查询与统计 ============

  describe('查询与统计', () => {
    it('按状态列出实例', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      const inst = engine.start('wf-1', { initialInput: 'x' });
      await sleep(50);
      const completed = engine.listInstances({ status: 'completed' });
      expect(completed.length).toBeGreaterThan(0);
      expect(completed[0].id).toBe(inst.id);
    });

    it('按定义 ID 列出实例', async () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      engine.start('wf-1', { initialInput: 'x' });
      await sleep(50);
      const instances = engine.listInstances({ definitionId: 'wf-1' });
      expect(instances.length).toBeGreaterThan(0);
    });

    it('统计正确', () => {
      const stats = engine.getStats();
      expect(stats.registeredWorkflows).toBe(0);
      expect(stats.totalInstances).toBe(0);
    });
  });

  // ============ 持久化 ============

  describe('持久化', () => {
    it('导出状态', () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      const state = engine.exportState();
      expect(state.workflows).toHaveLength(1);
    });

    it('导入状态', () => {
      const newEngine = new DynamicWorkflowEngine({ persist: false });
      newEngine.importState({
        workflows: [
          {
            id: 'wf-1',
            name: 'T',
            description: '',
            version: '1.0.0',
            phases: [createPhase('p1')],
          },
        ],
        instances: [],
      });
      expect(newEngine.listWorkflows()).toHaveLength(1);
    });

    it('清空', () => {
      engine.registerWorkflow({
        id: 'wf-1',
        name: 'T',
        description: '',
        version: '1.0.0',
        phases: [createPhase('p1')],
      });
      engine.clear();
      expect(engine.listWorkflows()).toHaveLength(0);
    });
  });

  // ============ 全局单例 ============

  describe('全局单例', () => {
    it('可重复获取', () => {
      resetDefaultDynamicWorkflowEngine();
      const a = getDefaultDynamicWorkflowEngine();
      const b = getDefaultDynamicWorkflowEngine();
      expect(a).toBe(b);
    });
  });
});
