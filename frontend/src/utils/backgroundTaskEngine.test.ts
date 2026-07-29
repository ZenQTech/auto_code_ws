/**
 * BackgroundTaskEngine 单元测试 (v1.0.0 Cycle 19 G19-01)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BackgroundTaskEngine,
  TASK_ACTIVE_STATUSES,
  TASK_TERMINAL_STATUSES,
  isActiveStatus,
  isTerminalStatus,
} from './backgroundTaskEngine';

describe('BackgroundTaskEngine', () => {
  let engine: BackgroundTaskEngine;
  let mockStorage: Record<string, string>;

  beforeEach(() => {
    mockStorage = {};
    // Mock localStorage
    (globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem: vi.fn((key: string) => mockStorage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        mockStorage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete mockStorage[key];
      }),
      clear: vi.fn(() => {
        mockStorage = {};
      }),
    };

    engine = new BackgroundTaskEngine({
      maxConcurrent: 2,
      maxHistory: 10,
      enablePersistence: true,
      storageKey: 'test.tasks',
    });
  });

  afterEach(() => {
    engine.clear();
  });

  describe('createTask', () => {
    it('应该创建任务并设置初始状态', () => {
      const task = engine.createTask({
        type: 'composer',
        prompt: '重构认证模块',
      });
      expect(task.id).toBeTruthy();
      expect(task.type).toBe('composer');
      expect(task.title).toContain('重构');
      expect(['pending', 'queued', 'running']).toContain(task.status);
    });

    it('应该自动启动任务（默认）', () => {
      const task = engine.createTask({
        type: 'composer',
        prompt: 'test',
      });
      // 启动后要么是 running 要么是 queued（超过并发）
      expect(['running', 'queued']).toContain(task.status);
    });

    it('应该支持 autoStart=false', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'test' },
        { autoStart: false }
      );
      expect(task.status).toBe('queued');
    });

    it('应该为不同类型生成不同的默认 title', () => {
      const t1 = engine.createTask({ type: 'review', files: ['a.ts', 'b.ts'] });
      const t2 = engine.createTask({ type: 'best-of-n', prompt: 'test', models: ['m1', 'm2'] });
      const t3 = engine.createTask({ type: 'brainstorm', topic: '项目规划' });
      expect(t1.title).toContain('2 file');
      expect(t2.title).toContain('2 models');
      expect(t3.title).toContain('项目规划');
    });
  });

  describe('startTask', () => {
    it('pending → running', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.startTask(task.id);
      expect(engine.getTask(task.id)?.status).toBe('running');
    });

    it('超过并发限制时进入 queued', () => {
      const t1 = engine.createTask({ type: 'composer', prompt: 'a' });
      const t2 = engine.createTask({ type: 'composer', prompt: 'b' });
      const t3 = engine.createTask(
        { type: 'composer', prompt: 'c' },
        { autoStart: false }
      );
      // t1, t2 应该是 running
      expect(engine.getTask(t1.id)?.status).toBe('running');
      expect(engine.getTask(t2.id)?.status).toBe('running');
      engine.startTask(t3.id);
      // t3 应该 queued
      expect(engine.getTask(t3.id)?.status).toBe('queued');
    });

    it('不存在的任务抛错', () => {
      expect(() => engine.startTask('nonexistent')).toThrow('Task not found');
    });

    it('done 状态不能启动', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.completeTask(task.id, { type: 'composer', summary: 'ok' });
      expect(() => engine.startTask(task.id)).toThrow('Cannot start');
    });
  });

  describe('pauseTask / resumeTask', () => {
    it('running → paused', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.startTask(task.id);
      engine.pauseTask(task.id);
      expect(engine.getTask(task.id)?.status).toBe('paused');
    });

    it('paused → running', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.startTask(task.id);
      engine.pauseTask(task.id);
      engine.resumeTask(task.id);
      expect(engine.getTask(task.id)?.status).toBe('running');
    });

    it('非 running 状态不能暂停', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      expect(() => engine.pauseTask(task.id)).toThrow('Cannot pause');
    });
  });

  describe('cancelTask', () => {
    it('任意状态可取消', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.cancelTask(task.id);
      expect(engine.getTask(task.id)?.status).toBe('cancelled');
    });

    it('已终态任务取消幂等', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.cancelTask(task.id);
      engine.cancelTask(task.id); // 不应抛错
      expect(engine.getTask(task.id)?.status).toBe('cancelled');
    });
  });

  describe('retryTask', () => {
    it('error 状态可重试', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.failTask(task.id, { code: 'X', message: 'fail', timestamp: Date.now() });
      engine.retryTask(task.id);
      const reloaded = engine.getTask(task.id);
      expect(reloaded?.status).toBe('running');
      expect(reloaded?.error).toBeUndefined();
      expect(reloaded?.progress).toBe(0);
    });

    it('done 状态不能重试', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.completeTask(task.id, { type: 'composer', summary: 'ok' });
      expect(() => engine.retryTask(task.id)).toThrow('Cannot retry');
    });
  });

  describe('completeTask / failTask', () => {
    it('completeTask → done', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.startTask(task.id);
      engine.completeTask(task.id, { type: 'composer', summary: 'finished' });
      const reloaded = engine.getTask(task.id);
      expect(reloaded?.status).toBe('done');
      expect(reloaded?.result).toEqual({ type: 'composer', summary: 'finished' });
      expect(reloaded?.duration).toBeGreaterThanOrEqual(0);
    });

    it('failTask → error', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.startTask(task.id);
      engine.failTask(task.id, 'Something failed');
      const reloaded = engine.getTask(task.id);
      expect(reloaded?.status).toBe('error');
      expect(reloaded?.error?.message).toBe('Something failed');
    });
  });

  describe('listTasks', () => {
    it('按类型过滤', () => {
      engine.createTask({ type: 'composer', prompt: 'a' });
      engine.createTask({ type: 'review', files: ['x'] });
      const composers = engine.listTasks({ type: 'composer' });
      expect(composers.every(t => t.type === 'composer')).toBe(true);
    });

    it('按状态过滤', () => {
      engine.createTask({ type: 'composer', prompt: 'a' });
      const cancelled = engine.createTask(
        { type: 'composer', prompt: 'b' },
        { autoStart: false }
      );
      engine.cancelTask(cancelled.id);
      const done = engine.listTasks({ status: 'cancelled' });
      expect(done.length).toBe(1);
    });

    it('按标题搜索', () => {
      engine.createTask({ type: 'composer', prompt: '修复登录 bug' });
      engine.createTask({ type: 'composer', prompt: '添加新功能' });
      const results = engine.listTasks({ search: '登录' });
      expect(results.length).toBe(1);
    });

    it('limit + offset 分页', () => {
      for (let i = 0; i < 5; i++) {
        engine.createTask({ type: 'composer', prompt: `task${i}` });
      }
      const page1 = engine.listTasks({ limit: 2, offset: 0 });
      const page2 = engine.listTasks({ limit: 2, offset: 2 });
      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
    });
  });

  describe('getActiveTasks / getHistoryTasks', () => {
    it('getActiveTasks 只返回激活状态', () => {
      const a = engine.createTask({ type: 'composer', prompt: 'a' });
      const b = engine.createTask(
        { type: 'composer', prompt: 'b' },
        { autoStart: false }
      );
      engine.completeTask(b.id, { type: 'composer', summary: 'ok' });
      const active = engine.getActiveTasks();
      expect(active.some(t => t.id === a.id)).toBe(true);
      expect(active.some(t => t.id === b.id)).toBe(false);
    });

    it('getHistoryTasks 只返回终态', () => {
      engine.createTask({ type: 'composer', prompt: 'a' });
      const b = engine.createTask(
        { type: 'composer', prompt: 'b' },
        { autoStart: false }
      );
      engine.completeTask(b.id, { type: 'composer', summary: 'ok' });
      const history = engine.getHistoryTasks();
      expect(history.every(t => isTerminalStatus(t.status))).toBe(true);
    });
  });

  describe('getStats', () => {
    it('应该返回正确的统计信息', () => {
      engine.createTask({ type: 'composer', prompt: 'a' });
      const b = engine.createTask(
        { type: 'composer', prompt: 'b' },
        { autoStart: false }
      );
      engine.completeTask(b.id, { type: 'composer', summary: 'ok' });
      const c = engine.createTask(
        { type: 'composer', prompt: 'c' },
        { autoStart: false }
      );
      engine.failTask(c.id, 'error');
      const stats = engine.getStats();
      expect(stats.total).toBeGreaterThanOrEqual(3);
      expect(stats.done).toBe(1);
      expect(stats.error).toBe(1);
    });
  });

  describe('事件总线', () => {
    it('emit created 事件', () => {
      const handler = vi.fn();
      engine.on('created', handler);
      const task = engine.createTask({ type: 'composer', prompt: 'a' });
      expect(handler).toHaveBeenCalledWith({ type: 'created', task });
    });

    it('emit progress 事件', () => {
      const handler = vi.fn();
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.on('progress', handler);
      engine.startTask(task.id);
      engine.updateProgress(task.id, 50);
      expect(handler).toHaveBeenCalledWith({
        type: 'progress',
        taskId: task.id,
        progress: 50,
        message: undefined,
      });
    });

    it('unsubscribe 取消订阅', () => {
      const handler = vi.fn();
      const unsub = engine.on('created', handler);
      unsub();
      engine.createTask({ type: 'composer', prompt: 'a' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('持久化', () => {
    it('应该保存到 localStorage', () => {
      engine.createTask({ type: 'composer', prompt: 'a' });
      engine.persist();
      expect(localStorage.setItem).toHaveBeenCalled();
    });

    it('应该从 localStorage 恢复', () => {
      const task = engine.createTask({ type: 'composer', prompt: 'a' });
      engine.persist();
      const newEngine = new BackgroundTaskEngine({
        enablePersistence: true,
        storageKey: 'test.tasks',
      });
      const restored = newEngine.getTask(task.id);
      expect(restored).not.toBeNull();
      newEngine.clear();
    });

    it('恢复时 running → queued（存储层）', () => {
      // 创建一个任务并停止模拟进度
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      // 任务此时是 queued
      // 手动设置成 running 来模拟
      engine.startTask(task.id);
      engine.pauseTask(task.id);
      const beforeRestore = engine.getTask(task.id);
      // 此时应该是 paused
      expect(beforeRestore?.status).toBe('paused');
      engine.persist();
      // 直接验证 storage 层的数据转换
      const storage = new (engine as any).storage.constructor({
        maxConcurrent: 2,
        maxHistory: 10,
        enablePersistence: true,
        storageKey: 'test.tasks',
      });
      const loaded = storage.load();
      const found = loaded.find((t: any) => t.id === task.id);
      // 恢复时：paused → queued
      expect(found?.status).toBe('queued');
    });
  });

  describe('清理', () => {
    it('clearHistory 只清空终态任务', () => {
      const active = engine.createTask({ type: 'composer', prompt: 'a' });
      const done = engine.createTask(
        { type: 'composer', prompt: 'b' },
        { autoStart: false }
      );
      engine.completeTask(done.id, { type: 'composer', summary: 'ok' });
      engine.clearHistory();
      expect(engine.getTask(active.id)).not.toBeNull();
      expect(engine.getTask(done.id)).toBeNull();
    });

    it('removeTask 删除指定任务', () => {
      const task = engine.createTask(
        { type: 'composer', prompt: 'a' },
        { autoStart: false }
      );
      engine.cancelTask(task.id);
      engine.removeTask(task.id);
      expect(engine.getTask(task.id)).toBeNull();
    });

    it('running 状态不能 remove', () => {
      const task = engine.createTask({ type: 'composer', prompt: 'a' });
      expect(() => engine.removeTask(task.id)).toThrow('Cannot remove');
    });

    it('clear 清空所有', () => {
      engine.createTask({ type: 'composer', prompt: 'a' });
      engine.clear();
      expect(engine.listTasks().length).toBe(0);
    });
  });

  describe('辅助函数', () => {
    it('TASK_ACTIVE_STATUSES 包含正确状态', () => {
      expect(TASK_ACTIVE_STATUSES).toContain('pending');
      expect(TASK_ACTIVE_STATUSES).toContain('queued');
      expect(TASK_ACTIVE_STATUSES).toContain('running');
      expect(TASK_ACTIVE_STATUSES).toContain('paused');
    });

    it('TASK_TERMINAL_STATUSES 包含正确状态', () => {
      expect(TASK_TERMINAL_STATUSES).toContain('done');
      expect(TASK_TERMINAL_STATUSES).toContain('error');
      expect(TASK_TERMINAL_STATUSES).toContain('cancelled');
    });

    it('isActiveStatus / isTerminalStatus', () => {
      expect(isActiveStatus('running')).toBe(true);
      expect(isActiveStatus('done')).toBe(false);
      expect(isTerminalStatus('done')).toBe(true);
      expect(isTerminalStatus('running')).toBe(false);
    });
  });
});
