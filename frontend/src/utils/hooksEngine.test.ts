/**
 * HooksEngine 单元测试 (v1.0.0 Cycle 20 G20-03)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  HooksEngine,
  getHooksEngine,
  resetHooksEngine,
  isHooksEngineInitialized,
  ALL_HOOK_TYPES,
  DEFAULT_HOOKS,
  triggerHook,
  triggerBeforePrompt,
  triggerAfterResponse,
  triggerThinking,
  type HookDefinition,
} from './hooksEngine';

describe('HooksEngine', () => {
  let engine: HooksEngine;

  beforeEach(() => {
    engine = new HooksEngine();
  });

  describe('registerHook', () => {
    it('注册 Hook', () => {
      const hook: HookDefinition = {
        id: 'test-1',
        type: 'after_prompt',
        name: 'Test',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'tester',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      };
      engine.registerHook(hook);
      expect(engine.get('test-1')).toBeDefined();
    });

    it('拒绝无效 Hook（缺 id）', () => {
      expect(() => engine.registerHook({
        id: '',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      })).toThrow();
    });

    it('拒绝无效类型', () => {
      expect(() => engine.registerHook({
        id: 't',
        type: 'invalid' as unknown as HookDefinition['type'],
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      })).toThrow();
    });
  });

  describe('unregisterHook', () => {
    it('注销存在的 Hook', () => {
      engine.registerHook({
        id: 't1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      engine.unregisterHook('t1');
      expect(engine.get('t1')).toBeNull();
    });

    it('注销不存在的 Hook 不抛错', () => {
      engine.unregisterHook('not-exist');
    });
  });

  describe('setEnabled', () => {
    it('启用 Hook', () => {
      const hook: HookDefinition = {
        id: 't1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: false,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      };
      engine.registerHook(hook);
      engine.setEnabled('t1', true);
      expect(engine.get('t1')?.enabled).toBe(true);
    });

    it('不存在的 Hook 抛错', () => {
      expect(() => engine.setEnabled('not-exist', true)).toThrow();
    });
  });

  describe('trigger', () => {
    it('无匹配 Hook 返回空数组', async () => {
      const results = await engine.trigger('after_prompt', { text: 'hello' });
      expect(results).toEqual([]);
    });

    it('触发匹配 Hook', async () => {
      const handler = vi.fn();
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'test',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const results = await engine.trigger('after_prompt', { text: 'hello' });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
      expect(handler).toHaveBeenCalled();
    });

    it('不匹配条件时跳过', async () => {
      const handler = vi.fn();
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'test',
        scope: 'user',
        enabled: true,
        condition: { keywords: ['special'] },
        action: { type: 'callback', handler },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const results = await engine.trigger('after_prompt', { text: 'no match' });
      expect(results).toHaveLength(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it('匹配关键词条件', async () => {
      const handler = vi.fn();
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'test',
        scope: 'user',
        enabled: true,
        condition: { keywords: ['special'] },
        action: { type: 'callback', handler },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const results = await engine.trigger('after_prompt', { text: 'this is special text' });
      expect(results).toHaveLength(1);
    });

    it('禁用 Hook 不触发', async () => {
      const handler = vi.fn();
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'test',
        scope: 'user',
        enabled: false,
        action: { type: 'callback', handler },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const results = await engine.trigger('after_prompt', { text: 'hello' });
      expect(results).toHaveLength(0);
    });

    it('按优先级排序', async () => {
      const order: string[] = [];
      engine.registerHook({
        id: 'h-low',
        type: 'after_prompt',
        name: 'low',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => { order.push('low'); } },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      engine.registerHook({
        id: 'h-high',
        type: 'after_prompt',
        name: 'high',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => { order.push('high'); } },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 10,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: 'hello' });
      expect(order[0]).toBe('high');
    });

    it('webhook action', async () => {
      engine.registerHook({
        id: 'webhook-1',
        type: 'after_response',
        name: 'webhook',
        scope: 'team',
        enabled: true,
        action: { type: 'webhook', url: 'http://invalid.example/hook', method: 'POST' },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 100,
        retries: 0,
        fallback: 'ignore',
      });
      const results = await engine.trigger('after_response', { text: 'hi' });
      expect(results).toHaveLength(1);
      // 失败（因为 URL 无效）但不抛错
      expect(['failed', 'timeout']).toContain(results[0].status);
    });

    it('command action', async () => {
      engine.registerHook({
        id: 'cmd-1',
        type: 'tool_execution',
        name: 'cmd',
        scope: 'project',
        enabled: true,
        action: { type: 'command', command: 'echo' },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const results = await engine.trigger('tool_execution', { cmd: 'ls' });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
    });

    it('script action', async () => {
      engine.registerHook({
        id: 'script-1',
        type: 'thinking',
        name: 'script',
        scope: 'user',
        enabled: true,
        action: { type: 'script', code: 'console.log("hi")', language: 'javascript' },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const results = await engine.trigger('thinking', { thought: 'a' });
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('success');
    });

    it('记录执行日志', async () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'test',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: 'hello' });
      const log = engine.getExecutionLog();
      expect(log).toHaveLength(1);
    });

    it('拒绝无效 Hook 类型', async () => {
      await expect(engine.trigger('invalid' as unknown as HookDefinition['type'], { text: 'x' })).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('空列表', () => {
      expect(engine.list()).toEqual([]);
    });

    it('按 type 过滤', () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      engine.registerHook({
        id: 'h2',
        type: 'thinking',
        name: 'Y',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const result = engine.list({ type: 'after_prompt' });
      expect(result).toHaveLength(1);
    });

    it('按 scope 过滤', () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'team',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      engine.registerHook({
        id: 'h2',
        type: 'after_prompt',
        name: 'Y',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const result = engine.list({ scope: 'team' });
      expect(result).toHaveLength(1);
    });

    it('按 enabled 过滤', () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const result = engine.list({ enabled: true });
      expect(result).toHaveLength(1);
    });
  });

  describe('getExecutionLog', () => {
    it('按 hookId 过滤', async () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: 'hi' });
      const log = engine.getExecutionLog({ hookId: 'h1' });
      expect(log.every(r => r.hookId === 'h1')).toBe(true);
    });

    it('按 status 过滤', async () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: 'hi' });
      const log = engine.getExecutionLog({ status: 'success' });
      expect(log.every(r => r.status === 'success')).toBe(true);
    });

    it('限制数量', async () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: '1' });
      await engine.trigger('after_prompt', { text: '2' });
      await engine.trigger('after_prompt', { text: '3' });
      const log = engine.getExecutionLog({ limit: 2 });
      expect(log).toHaveLength(2);
    });
  });

  describe('clearExecutionLog', () => {
    it('清空日志', async () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: 'hi' });
      engine.clearExecutionLog();
      expect(engine.getExecutionLog()).toHaveLength(0);
    });
  });

  describe('clear', () => {
    it('清空所有 Hook', () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      engine.clear();
      expect(engine.list()).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('返回统计', () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'team',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      const stats = engine.getStats();
      expect(stats.totalHooks).toBe(1);
      expect(stats.enabledHooks).toBe(1);
      expect(stats.byType.after_prompt).toBe(1);
      expect(stats.byScope.team).toBe(1);
    });

    it('计算 successRate', async () => {
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: 'hi' });
      const stats = engine.getStats();
      expect(stats.successRate).toBe(1);
    });
  });

  describe('on', () => {
    it('订阅 hook-triggered', async () => {
      const events: number[] = [];
      engine.on('hook-triggered', () => events.push(1));
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: 'hi' });
      expect(events.length).toBeGreaterThan(0);
    });

    it('订阅 hook-completed', async () => {
      const events: number[] = [];
      engine.on('hook-completed', () => events.push(1));
      engine.registerHook({
        id: 'h1',
        type: 'after_prompt',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'callback', handler: () => {} },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 5000,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_prompt', { text: 'hi' });
      expect(events).toHaveLength(1);
    });

    it('订阅 hook-failed', async () => {
      const events: number[] = [];
      engine.on('hook-failed', () => events.push(1));
      engine.registerHook({
        id: 'h1',
        type: 'after_response',
        name: 'X',
        scope: 'user',
        enabled: true,
        action: { type: 'webhook', url: 'http://invalid', method: 'POST' },
        createdAt: Date.now(),
        createdBy: 'x',
        priority: 100,
        timeoutMs: 100,
        retries: 0,
        fallback: 'ignore',
      });
      await engine.trigger('after_response', { text: 'hi' });
      expect(events.length).toBeGreaterThan(0);
    });
  });
});

describe('便捷函数', () => {
  beforeEach(() => {
    resetHooksEngine();
  });

  it('triggerBeforePrompt', async () => {
    const engine = getHooksEngine();
    engine.registerHook({
      id: 'h1',
      type: 'before_prompt',
      name: 'X',
      scope: 'user',
      enabled: true,
      action: { type: 'callback', handler: () => {} },
      createdAt: Date.now(),
      createdBy: 'x',
      priority: 100,
      timeoutMs: 5000,
      retries: 0,
      fallback: 'ignore',
    });
    const results = await triggerBeforePrompt({ text: 'hi' });
    expect(results).toHaveLength(1);
  });

  it('triggerAfterResponse', async () => {
    const engine = getHooksEngine();
    engine.registerHook({
      id: 'h1',
      type: 'after_response',
      name: 'X',
      scope: 'user',
      enabled: true,
      action: { type: 'callback', handler: () => {} },
      createdAt: Date.now(),
      createdBy: 'x',
      priority: 100,
      timeoutMs: 5000,
      retries: 0,
      fallback: 'ignore',
    });
    const results = await triggerAfterResponse({ text: 'hi' });
    expect(results).toHaveLength(1);
  });

  it('triggerThinking', async () => {
    const engine = getHooksEngine();
    engine.registerHook({
      id: 'h1',
      type: 'thinking',
      name: 'X',
      scope: 'user',
      enabled: true,
      action: { type: 'callback', handler: () => {} },
      createdAt: Date.now(),
      createdBy: 'x',
      priority: 100,
      timeoutMs: 5000,
      retries: 0,
      fallback: 'ignore',
    });
    const results = await triggerThinking({ thought: 'a' });
    expect(results).toHaveLength(1);
  });

  it('triggerHook 通用', async () => {
    const engine = getHooksEngine();
    engine.registerHook({
      id: 'h1',
      type: 'tool_execution',
      name: 'X',
      scope: 'user',
      enabled: true,
      action: { type: 'callback', handler: () => {} },
      createdAt: Date.now(),
      createdBy: 'x',
      priority: 100,
      timeoutMs: 5000,
      retries: 0,
      fallback: 'ignore',
    });
    const results = await triggerHook('tool_execution', { cmd: 'ls' });
    expect(results).toHaveLength(1);
  });
});

describe('HooksEngine 单例', () => {
  beforeEach(() => {
    resetHooksEngine();
  });

  it('初始化前为 false', () => {
    expect(isHooksEngineInitialized()).toBe(false);
  });

  it('首次调用创建实例并注册预置 Hooks', () => {
    const e = getHooksEngine();
    expect(e).toBeInstanceOf(HooksEngine);
    expect(isHooksEngineInitialized()).toBe(true);
    expect(e.list().length).toBeGreaterThan(0);
  });

  it('后续调用返回同一实例', () => {
    const a = getHooksEngine();
    const b = getHooksEngine();
    expect(a).toBe(b);
  });

  it('重置后返回新实例', () => {
    const a = getHooksEngine();
    resetHooksEngine();
    const b = getHooksEngine();
    expect(a).not.toBe(b);
  });
});

describe('ALL_HOOK_TYPES', () => {
  it('包含 10 种类型', () => {
    expect(ALL_HOOK_TYPES).toHaveLength(10);
    expect(ALL_HOOK_TYPES).toContain('before_prompt');
    expect(ALL_HOOK_TYPES).toContain('after_prompt');
    expect(ALL_HOOK_TYPES).toContain('thinking');
    expect(ALL_HOOK_TYPES).toContain('subagent_start');
    expect(ALL_HOOK_TYPES).toContain('subagent_end');
    expect(ALL_HOOK_TYPES).toContain('compaction');
    expect(ALL_HOOK_TYPES).toContain('turn_complete');
    expect(ALL_HOOK_TYPES).toContain('tool_execution');
  });
});

describe('DEFAULT_HOOKS', () => {
  it('至少包含一个预置 Hook', () => {
    expect(DEFAULT_HOOKS.length).toBeGreaterThan(0);
    DEFAULT_HOOKS.forEach(h => {
      expect(h.id).toBeDefined();
      expect(h.type).toBeDefined();
      expect(h.action).toBeDefined();
    });
  });
});
