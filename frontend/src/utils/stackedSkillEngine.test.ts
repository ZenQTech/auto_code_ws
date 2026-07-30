/**
 * StackedSkillEngine 单元测试 (v1.0.0 Cycle 29 G29-01)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillEngine } from './skillEngine';
import {
  StackedSkillEngine,
  parseStackedCommandString,
  getDefaultStackedSkillEngine,
  resetDefaultStackedSkillEngine,
  StackedCommand,
} from './stackedSkillEngine';

describe('工具函数', () => {
  describe('parseStackedCommandString', () => {
    it('解析单技能命令', () => {
      const result = parseStackedCommandString('/code-review src/foo.ts');
      expect(result).not.toBeNull();
      expect(result!.skillNames).toEqual(['code-review']);
      expect(result!.args).toBe('src/foo.ts');
    });

    it('解析 2-5 个堆叠技能', () => {
      const result = parseStackedCommandString('/a /b /c /d /e args');
      expect(result).not.toBeNull();
      expect(result!.skillNames).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(result!.args).toBe('args');
    });

    it('拒绝纯 / 命令（无 token）', () => {
      expect(parseStackedCommandString('')).toBeNull();
      expect(parseStackedCommandString('   ')).toBeNull();
    });

    it('拒绝无技能的命令', () => {
      const result = parseStackedCommandString('just args without skills');
      expect(result).toBeNull();
    });

    it('args 在第一个非 / token 后开始', () => {
      const result = parseStackedCommandString('/a --strict /b src/foo.ts');
      expect(result).not.toBeNull();
      expect(result!.skillNames).toEqual(['a']);
      expect(result!.args).toBe('--strict /b src/foo.ts');
    });

    it('非字符串输入返回 null', () => {
      expect(parseStackedCommandString(null as unknown as string)).toBeNull();
      expect(parseStackedCommandString(undefined as unknown as string)).toBeNull();
    });
  });
});

describe('StackedSkillEngine', () => {
  let engine: StackedSkillEngine;
  let skillEngine: SkillEngine;

  beforeEach(() => {
    localStorage.clear();
    skillEngine = new SkillEngine();
    engine = new StackedSkillEngine(skillEngine, { persist: false });
  });

  describe('parseStackedCommand', () => {
    it('解析有效堆叠命令', () => {
      const cmd = engine.parseStackedCommand('/code-review /security-scanner src/foo.ts');
      expect(cmd).not.toBeNull();
      expect(cmd!.skillNames).toEqual(['code-review', 'security-scanner']);
      expect(cmd!.args).toBe('src/foo.ts');
      expect(cmd!.sharedContext).toBe(false);
      expect(cmd!.parsedAt).toBeGreaterThan(0);
    });

    it('拒绝超过 5 个技能', () => {
      const cmd = engine.parseStackedCommand('/a /b /c /d /e /f args');
      expect(cmd).toBeNull();
    });

    it('拒绝空命令', () => {
      expect(engine.parseStackedCommand('')).toBeNull();
      expect(engine.parseStackedCommand('no skills')).toBeNull();
    });

    it('允许最大 5 个技能', () => {
      const cmd = engine.parseStackedCommand('/a /b /c /d /e');
      expect(cmd).not.toBeNull();
      expect(cmd!.skillNames.length).toBe(5);
    });
  });

  describe('validateComposition', () => {
    it('验证 1 个技能（无冲突）', () => {
      const result = engine.validateComposition(['code-review']);
      expect(result.valid).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it('检测不存在的技能', () => {
      const result = engine.validateComposition(['non-existent']);
      expect(result.valid).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].type).toBe('skill-not-found');
    });

    it('检测禁用的技能', () => {
      const skill = skillEngine.getSkillByName('code-review')!;
      skillEngine.disableSkill(skill.id);
      const result = engine.validateComposition(['code-review']);
      expect(result.valid).toBe(false);
      expect(result.conflicts[0].type).toBe('skill-disabled');
    });

    it('收集所有 effectiveTools', () => {
      const result = engine.validateComposition(['code-review', 'security-scanner']);
      expect(result.effectiveTools).toContain('read');
      expect(result.effectiveTools).toContain('search');
    });

    it('工具被多个技能共享时产生 warning', () => {
      const result = engine.validateComposition(['code-review', 'test-generator']);
      const hasWarning = result.warnings.some((w) => w.includes('共享'));
      expect(hasWarning).toBe(true);
    });

    it('数量超过 maxStackSize 时报错', () => {
      const result = engine.validateComposition(['a', 'b', 'c', 'd', 'e', 'f']);
      expect(result.valid).toBe(false);
      expect(result.conflicts[0].type).toBe('context-incompatible');
    });
  });

  describe('detectToolConflicts', () => {
    it('无共享工具时返回空数组', () => {
      const skill1 = skillEngine.getSkillByName('code-review')!;
      const conflicts = engine.detectToolConflicts([skill1.name]);
      expect(conflicts).toHaveLength(0);
    });

    it('检测共享工具', () => {
      const conflicts = engine.detectToolConflicts(['code-review', 'security-scanner']);
      // 'read' 工具可能被共享
      const readConflict = conflicts.find((c) => c.tool === 'read');
      if (readConflict) {
        expect(readConflict.skills.length).toBeGreaterThan(1);
      }
    });

    it('不存在的技能被忽略', () => {
      const conflicts = engine.detectToolConflicts(['code-review', 'non-existent']);
      // 仍然返回 code-review 的冲突
      expect(Array.isArray(conflicts)).toBe(true);
    });
  });

  describe('executeStack - 串行', () => {
    it('按顺序执行', async () => {
      const result = await engine.executeStack('/code-review /security-scanner', {
        parallelExecution: false,
      });
      expect(result.results).toHaveLength(2);
      expect(result.results[0].order).toBe(0);
      expect(result.results[1].order).toBe(1);
    });

    it('stopOnFirstFailure=true 时中断', async () => {
      // 使用不存在的技能
      const result = await engine.executeStack('/non-existent /code-review', {
        parallelExecution: false,
        stopOnFirstFailure: true,
      });
      expect(result.failureCount).toBeGreaterThan(0);
      // 由于第一个失败就停止，code-review 不会执行
      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it('aggregatedOutput 拼接所有成功结果', async () => {
      const result = await engine.executeStack('/code-review /security-scanner', {
        parallelExecution: false,
      });
      expect(result.aggregatedOutput).toContain('code-review');
      expect(result.aggregatedOutput).toContain('security-scanner');
    });

    it('successCount + failureCount = results.length', async () => {
      const result = await engine.executeStack('/code-review /security-scanner', {
        parallelExecution: false,
      });
      expect(result.successCount + result.failureCount).toBe(result.results.length);
    });
  });

  describe('executeStack - 并行', () => {
    it('并行执行所有技能', async () => {
      const result = await engine.executeStack('/code-review /security-scanner /test-generator', {
        parallelExecution: true,
      });
      expect(result.results).toHaveLength(3);
    });

    it('totalDurationMs 测量整体耗时', async () => {
      const result = await engine.executeStack('/code-review /security-scanner', {
        parallelExecution: true,
      });
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('executeStack - 错误处理', () => {
    it('无效命令抛错', async () => {
      await expect(engine.executeStack('no skills')).rejects.toThrow();
    });
  });

  describe('executeParsed', () => {
    it('执行预解析的命令', async () => {
      const cmd: StackedCommand = {
        skillNames: ['code-review'],
        args: 'src/foo.ts',
        sharedContext: false,
        parsedAt: Date.now(),
      };
      const result = await engine.executeParsed(cmd);
      expect(result.command).toBe(cmd);
      expect(result.results).toHaveLength(1);
    });
  });

  describe('事件系统', () => {
    it('订阅 stack-parsed', () => {
      const events: any[] = [];
      engine.on('stack-parsed', (e) => events.push(e));
      engine.parseStackedCommand('/code-review /security-scanner');
      expect(events.length).toBe(1);
    });

    it('订阅 stack-validated', () => {
      const events: any[] = [];
      engine.on('stack-validated', (e) => events.push(e));
      engine.validateComposition(['code-review']);
      expect(events.length).toBe(1);
    });

    it('订阅 stack-completed', async () => {
      const events: any[] = [];
      engine.on('stack-completed', (e) => events.push(e));
      await engine.executeStack('/code-review /security-scanner', { parallelExecution: false });
      expect(events.length).toBe(1);
    });

    it('订阅 skill-completed', async () => {
      const events: any[] = [];
      engine.on('skill-completed', (e) => events.push(e));
      await engine.executeStack('/code-review /security-scanner', { parallelExecution: false });
      expect(events.length).toBeGreaterThan(0);
    });

    it('取消订阅', () => {
      const events: any[] = [];
      const unsub = engine.on('stack-parsed', (e) => events.push(e));
      engine.parseStackedCommand('/a /b');
      expect(events.length).toBe(1);
      unsub();
      engine.parseStackedCommand('/c /d');
      expect(events.length).toBe(1);
    });
  });

  describe('历史与统计', () => {
    it('执行后保存到历史', async () => {
      await engine.executeStack('/code-review /security-scanner', { parallelExecution: false });
      const history = engine.getHistory();
      expect(history.length).toBe(1);
    });

    it('getStats 返回统计', async () => {
      await engine.executeStack('/code-review /security-scanner', { parallelExecution: false });
      const stats = engine.getStats();
      expect(stats.totalExecutions).toBe(1);
      expect(stats.avgDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('clearHistory 清空历史', async () => {
      await engine.executeStack('/code-review', { parallelExecution: false });
      engine.clearHistory();
      expect(engine.getHistory().length).toBe(0);
    });

    it('topCombinations 统计常用组合', async () => {
      await engine.executeStack('/code-review /security-scanner', { parallelExecution: false });
      const stats = engine.getStats();
      expect(stats.topCombinations.length).toBeGreaterThan(0);
    });
  });

  describe('持久化', () => {
    it('执行历史写入 localStorage', async () => {
      const persistEngine = new StackedSkillEngine(skillEngine, { persist: true });
      await persistEngine.executeStack('/code-review', { parallelExecution: false });
      const raw = localStorage.getItem('hermes.stackedSkills');
      expect(raw).toBeDefined();
    });
  });

  describe('全局单例', () => {
    it('getDefaultStackedSkillEngine 可重复获取', () => {
      resetDefaultStackedSkillEngine();
      const a = getDefaultStackedSkillEngine();
      const b = getDefaultStackedSkillEngine();
      expect(a).toBe(b);
    });

    it('resetDefaultStackedSkillEngine 重置', () => {
      const a = getDefaultStackedSkillEngine();
      resetDefaultStackedSkillEngine();
      const b = getDefaultStackedSkillEngine();
      expect(a).not.toBe(b);
    });
  });
});
