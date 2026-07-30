/**
 * SlashCommandEngine 单元测试 (v1.0.0 Cycle 28 G28-05)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { SlashCommandEngine, getDefaultSlashCommandEngine, BUILTIN_COMMANDS } from './slashCommandEngine';

describe('SlashCommandEngine', () => {
  let engine: SlashCommandEngine;

  beforeEach(() => {
    engine = new SlashCommandEngine();
  });

  describe('初始化', () => {
    it('注册所有内置命令', () => {
      const commands = engine.listCommands();
      expect(commands.length).toBeGreaterThanOrEqual(BUILTIN_COMMANDS.length);
      expect(engine.getCommand('init')).toBeDefined();
      expect(engine.getCommand('status')).toBeDefined();
      expect(engine.getCommand('review')).toBeDefined();
      expect(engine.getCommand('plan')).toBeDefined();
      expect(engine.getCommand('goal')).toBeDefined();
      expect(engine.getCommand('mcp')).toBeDefined();
      expect(engine.getCommand('next')).toBeDefined();
    });

    it('别名查找', () => {
      expect(engine.getCommand('initialize')).toBeDefined();
      expect(engine.getCommand('plan-mode')).toBeDefined();
    });
  });

  describe('命令管理', () => {
    it('registerCommand 用户命令', () => {
      engine.registerCommand({
        name: 'my-cmd',
        description: 'test',
        category: 'custom',
        type: 'user',
        handler: () => ({ success: true, output: 'ok' }),
      });
      expect(engine.getCommand('my-cmd')).toBeDefined();
    });

    it('unregisterCommand 用户命令', () => {
      engine.registerCommand({
        name: 'my-cmd',
        description: 'test',
        category: 'custom',
        type: 'user',
        handler: () => ({ success: true, output: 'ok' }),
      });
      expect(engine.unregisterCommand('my-cmd')).toBe(true);
    });

    it('unregisterCommand 内置失败', () => {
      expect(engine.unregisterCommand('init')).toBe(false);
    });

    it('listCommands 按 category 过滤', () => {
      const reviewCommands = engine.listCommands({ category: 'review' });
      expect(reviewCommands.every((c) => c.category === 'review')).toBe(true);
    });

    it('listCommands 按 enabled 过滤', () => {
      const enabled = engine.listCommands({ enabled: true });
      expect(enabled.every((c) => c.enabled !== false)).toBe(true);
    });
  });

  describe('parseInput', () => {
    it('基本解析', () => {
      const r = engine.parseInput('/init');
      expect(r?.name).toBe('init');
      expect(r?.args).toEqual([]);
    });

    it('带参数', () => {
      const r = engine.parseInput('/plan 重构用户模块');
      expect(r?.name).toBe('plan');
      expect(r?.args).toEqual(['重构用户模块']);
    });

    it('引号参数', () => {
      const r = engine.parseInput('/goal "实现 Cycle 28"');
      expect(r?.name).toBe('goal');
      expect(r?.args).toEqual(['实现 Cycle 28']);
    });

    it('非命令返回 null', () => {
      expect(engine.parseInput('hello')).toBeNull();
    });

    it('空命令返回 null', () => {
      expect(engine.parseInput('/')).toBeNull();
    });
  });

  describe('execute', () => {
    it('执行 /init', async () => {
      const r = await engine.execute('/init /home/project', {
        cwd: '/home/project',
        rawInput: '/init',
        metadata: {},
      });
      expect(r.success).toBe(true);
      expect(r.output).toContain('已初始化');
    });

    it('执行 /status', async () => {
      const r = await engine.execute('/status', { cwd: '/', rawInput: '/status', metadata: {} });
      expect(r.success).toBe(true);
      expect(r.output).toContain('会话状态');
    });

    it('执行 /goal 引号', async () => {
      const r = await engine.execute('/goal "实现 Cycle 28 P0 任务"', { cwd: '/', rawInput: '/goal', metadata: {} });
      expect(r.success).toBe(true);
      expect(r.output).toContain('Cycle 28');
    });

    it('未知命令失败', async () => {
      const r = await engine.execute('/unknown', { cwd: '/', rawInput: '/unknown', metadata: {} });
      expect(r.success).toBe(false);
      expect(r.error).toContain('Unknown command');
    });

    it('非命令格式失败', async () => {
      const r = await engine.execute('hello', { cwd: '/', rawInput: 'hello', metadata: {} });
      expect(r.success).toBe(false);
    });

    it('handler 抛错捕获', async () => {
      engine.registerCommand({
        name: 'failing',
        description: 'test',
        category: 'custom',
        type: 'user',
        handler: () => { throw new Error('intentional'); },
      });
      const r = await engine.execute('/failing', { cwd: '/', rawInput: '/failing', metadata: {} });
      expect(r.success).toBe(false);
      expect(r.error).toContain('intentional');
    });
  });

  describe('事件系统', () => {
    it('订阅 command-executed', async () => {
      const events: any[] = [];
      engine.on('command-executed', (e) => events.push(e));
      await engine.execute('/init', { cwd: '/', rawInput: '/init', metadata: {} });
      expect(events.length).toBe(1);
    });

    it('订阅 command-failed', async () => {
      const events: any[] = [];
      engine.on('command-failed', (e) => events.push(e));
      await engine.execute('/unknown', { cwd: '/', rawInput: '/unknown', metadata: {} });
      expect(events.length).toBe(1);
    });

    it('订阅 command-registered', () => {
      const events: any[] = [];
      engine.on('command-registered', (e) => events.push(e));
      engine.registerCommand({
        name: 'test',
        description: 'test',
        category: 'custom',
        type: 'user',
        handler: () => ({ success: true, output: '' }),
      });
      expect(events.length).toBe(1);
    });
  });
});

describe('单例', () => {
  it('getDefault 返回相同实例', () => {
    const a = getDefaultSlashCommandEngine();
    const b = getDefaultSlashCommandEngine();
    expect(a).toBe(b);
  });
});
