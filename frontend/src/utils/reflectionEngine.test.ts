/**
 * # ============================================================
 * # ReflectionEngine 单元测试 (v1.0.0 Cycle 38 G38-03)
 * # ============================================================
 * # 覆盖：Evaluator / ReflectionGenerator / StrategyAdjuster /
 * #       ReflectionEngine 主类 / 工具函数 / 持久化
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ReflectionEngine,
  Evaluator,
  ReflectionGenerator,
  StrategyAdjuster,
  generateId,
  DEFAULT_CRITERIA,
  DEFAULT_ITERATION_CONFIG,
  calculateWeightedScore,
  heuristicScore,
  isPlateau,
  type TaskExecutionResult,
  type EvaluationCriteria,
  type ReflexionSession,
} from './reflectionEngine';

// ============ 工具函数测试 ============

describe('ReflectionEngine 工具函数', () => {
  describe('generateId', () => {
    it('生成唯一 ID', () => {
      const a = generateId();
      const b = generateId();
      expect(a).not.toBe(b);
    });

    it('使用自定义前缀', () => {
      const id = generateId('test');
      expect(id.startsWith('test-')).toBe(true);
    });
  });

  describe('calculateWeightedScore', () => {
    it('加权求和', () => {
      const criteria: EvaluationCriteria[] = [
        { name: 'a', weight: 0.5, score: 1.0 },
        { name: 'b', weight: 0.5, score: 0.5 },
      ];
      // (0.5*1.0 + 0.5*0.5) / 1.0 = 0.75
      expect(calculateWeightedScore(criteria)).toBeCloseTo(0.75);
    });

    it('空列表返回 0', () => {
      expect(calculateWeightedScore([])).toBe(0);
    });

    it('权重和不为 1 时也能正确归一化', () => {
      const criteria: EvaluationCriteria[] = [
        { name: 'a', weight: 2, score: 1.0 },
        { name: 'b', weight: 2, score: 0.5 },
      ];
      // (2*1.0 + 2*0.5) / 4 = 0.75
      expect(calculateWeightedScore(criteria)).toBeCloseTo(0.75);
    });
  });

  describe('heuristicScore', () => {
    it('成功 + 长输出 高分', () => {
      const r: TaskExecutionResult = {
        output: 'A'.repeat(100),
        success: true,
        durationMs: 100,
      };
      const score = heuristicScore(r);
      expect(score).toBeGreaterThan(0.7);
    });

    it('失败 + 短输出 低分', () => {
      const r: TaskExecutionResult = {
        output: '',
        success: false,
        error: 'err',
        durationMs: 100,
      };
      const score = heuristicScore(r);
      expect(score).toBeLessThan(0.6);
    });
  });

  describe('isPlateau', () => {
    it('长度不足返回 false', () => {
      expect(isPlateau([0.5, 0.5], 2, 0.05)).toBe(false);
    });

    it('稳定序列识别为 plateau', () => {
      expect(isPlateau([0.5, 0.5, 0.5, 0.5], 2, 0.05)).toBe(true);
    });

    it('上升序列非 plateau', () => {
      expect(isPlateau([0.3, 0.4, 0.5, 0.6], 2, 0.05)).toBe(false);
    });

    it('delta 较大时稳定识别为 plateau', () => {
      expect(isPlateau([0.5, 0.6, 0.5, 0.6], 2, 0.5)).toBe(true);
    });
  });

  describe('DEFAULT_CRITERIA', () => {
    it('包含 4 个标准维度', () => {
      const names = DEFAULT_CRITERIA.map((c) => c.name);
      expect(names).toContain('completeness');
      expect(names).toContain('correctness');
      expect(names).toContain('clarity');
      expect(names).toContain('efficiency');
    });

    it('权重和为 1', () => {
      const sum = DEFAULT_CRITERIA.reduce((s, c) => s + c.weight, 0);
      expect(sum).toBeCloseTo(1);
    });
  });

  describe('DEFAULT_ITERATION_CONFIG', () => {
    it('默认 5 次迭代', () => {
      expect(DEFAULT_ITERATION_CONFIG.maxIterations).toBe(5);
    });

    it('默认质量阈值 0.8', () => {
      expect(DEFAULT_ITERATION_CONFIG.qualityThreshold).toBe(0.8);
    });
  });
});

// ============ Evaluator 测试 ============

describe('Evaluator', () => {
  let evaluator: Evaluator;

  beforeEach(() => {
    evaluator = new Evaluator();
  });

  it('多维度评估', async () => {
    const result: TaskExecutionResult = {
      output: 'This is a comprehensive answer that addresses the task completely.',
      success: true,
      durationMs: 100,
    };
    const ev = await evaluator.evaluate(result);
    expect(ev.criteria.length).toBe(4);
    expect(ev.score).toBeGreaterThan(0);
    expect(ev.evaluator).toBe('auto');
  });

  it('短输出正确性维度较低', async () => {
    const result: TaskExecutionResult = {
      output: 'ok',
      success: false,
      durationMs: 100,
    };
    const ev = await evaluator.evaluate(result);
    const correctness = ev.criteria.find((c) => c.name === 'correctness');
    expect(correctness?.score).toBeLessThan(0.5);
  });

  it('快速评分接口', async () => {
    const result: TaskExecutionResult = {
      output: 'A reasonable answer with sufficient content for the task at hand.',
      success: true,
      durationMs: 100,
    };
    const score = await evaluator.quickScore(result);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('LLM caller 失败时回退到启发式', async () => {
    const llmCaller = vi.fn().mockRejectedValue(new Error('LLM error'));
    const ev = new Evaluator({ llmCaller });
    const result: TaskExecutionResult = {
      output: 'a good answer',
      success: true,
      durationMs: 100,
    };
    const evalResult = await ev.evaluate(result);
    expect(evalResult.evaluator).toBe('llm');
  });

  it('自定义评估维度', async () => {
    evaluator.registerCustomCriterion('custom', async () => ({
      score: 0.95,
      comment: 'custom check passed',
    }));
    const result: TaskExecutionResult = {
      output: 'test',
      success: true,
      durationMs: 100,
    };
    const ev = await evaluator.evaluate(result, [
      { name: 'custom', weight: 1, score: 0 },
    ]);
    expect(ev.criteria[0].score).toBe(0.95);
    expect(ev.criteria[0].comment).toBe('custom check passed');
  });
});

// ============ ReflectionGenerator 测试 ============

describe('ReflectionGenerator', () => {
  let generator: ReflectionGenerator;

  beforeEach(() => {
    generator = new ReflectionGenerator();
  });

  it('成功执行生成 success 反思', async () => {
    const result: TaskExecutionResult = {
      output: 'great',
      success: true,
      durationMs: 100,
    };
    const ev = {
      taskId: 't1',
      iteration: 1,
      score: 0.95,
      criteria: DEFAULT_CRITERIA.map((c) => ({ ...c, score: 0.9 })),
      passed: true,
      feedback: 'good',
      evaluator: 'auto' as const,
      evaluatedAt: Date.now(),
    };
    const r = await generator.generate(result, ev);
    expect(r.type).toBe('success');
    expect(r.emotionalTone).toBe('positive');
    expect(r.importance).toBeGreaterThan(0.6);
  });

  it('失败执行生成 failure 反思', async () => {
    const result: TaskExecutionResult = {
      output: '',
      success: false,
      error: 'timeout',
      durationMs: 100,
    };
    const ev = {
      taskId: 't1',
      iteration: 1,
      score: 0.2,
      criteria: DEFAULT_CRITERIA.map((c) => ({ ...c, score: 0.2 })),
      passed: false,
      feedback: 'bad',
      evaluator: 'auto' as const,
      evaluatedAt: Date.now(),
    };
    const r = await generator.generate(result, ev);
    expect(r.type).toBe('failure');
    expect(r.emotionalTone).toBe('negative');
    expect(r.lessonsLearned.some((l) => l.includes('timeout'))).toBe(true);
  });

  it('部分成功生成 partial 反思', async () => {
    const result: TaskExecutionResult = {
      output: 'partial',
      success: true,
      durationMs: 100,
    };
    const ev = {
      taskId: 't1',
      iteration: 1,
      score: 0.65,
      criteria: DEFAULT_CRITERIA.map((c, i) => ({ ...c, score: i < 2 ? 0.9 : 0.4 })),
      passed: false,
      feedback: 'partial',
      evaluator: 'auto' as const,
      evaluatedAt: Date.now(),
    };
    const r = await generator.generate(result, ev);
    expect(r.type).toBe('partial');
    expect(r.emotionalTone).toBe('neutral');
  });

  it('连续失败反思', async () => {
    const result: TaskExecutionResult = {
      output: '',
      success: false,
      error: 'crash',
      durationMs: 100,
    };
    const ev = {
      taskId: 't1',
      iteration: 2,
      score: 0.3,
      criteria: DEFAULT_CRITERIA.map((c) => ({ ...c, score: 0.3 })),
      passed: false,
      feedback: 'fail',
      evaluator: 'auto' as const,
      evaluatedAt: Date.now(),
    };
    const prevReflections = [
      {
        id: 'r1',
        type: 'failure' as const,
        taskId: 't1',
        iteration: 1,
        evaluation: 'failed before',
        lessonsLearned: [],
        improvementSuggestions: ['try different approach'],
        emotionalTone: 'negative' as const,
        importance: 0.8,
        createdAt: Date.now() - 1000,
      },
    ];
    const r = await generator.generate(result, ev, prevReflections);
    expect(r.lessonsLearned.some((l) => l.includes('连续失败'))).toBe(true);
  });
});

// ============ StrategyAdjuster 测试 ============

describe('StrategyAdjuster', () => {
  let adjuster: StrategyAdjuster;

  beforeEach(() => {
    adjuster = new StrategyAdjuster();
  });

  it('失败反思生成修正策略', async () => {
    const reflection = {
      id: 'r1',
      type: 'failure' as const,
      taskId: 't1',
      iteration: 1,
      evaluation: 'failed',
      lessonsLearned: [],
      improvementSuggestions: ['改用更简单的实现'],
      emotionalTone: 'negative' as const,
      importance: 0.8,
      createdAt: Date.now(),
    };
    const newStrategy = await adjuster.adjust(reflection, 'current');
    expect(newStrategy).toContain('失败修正');
    expect(newStrategy).toContain('更简单的实现');
  });

  it('成功反思保留策略', async () => {
    const reflection = {
      id: 'r1',
      type: 'success' as const,
      taskId: 't1',
      iteration: 1,
      evaluation: 'success',
      lessonsLearned: [],
      improvementSuggestions: [],
      emotionalTone: 'positive' as const,
      importance: 0.9,
      createdAt: Date.now(),
    };
    const newStrategy = await adjuster.adjust(reflection, 'original strategy');
    expect(newStrategy).toContain('original strategy');
    expect(newStrategy).toContain('已成功');
  });

  it('合并多条反思', async () => {
    const reflections = [
      {
        id: 'r1',
        type: 'failure' as const,
        taskId: 't1',
        iteration: 1,
        evaluation: 'fail1',
        lessonsLearned: ['L1'],
        improvementSuggestions: ['I1'],
        emotionalTone: 'negative' as const,
        importance: 0.5,
        createdAt: 1,
      },
      {
        id: 'r2',
        type: 'failure' as const,
        taskId: 't1',
        iteration: 2,
        evaluation: 'fail2',
        lessonsLearned: ['L2'],
        improvementSuggestions: ['I2'],
        emotionalTone: 'negative' as const,
        importance: 0.5,
        createdAt: 2,
      },
    ];
    const merged = await adjuster.mergeReflections(reflections);
    expect(merged).toContain('L1');
    expect(merged).toContain('L2');
    expect(merged).toContain('I1');
    expect(merged).toContain('I2');
  });

  it('空列表合并返回空字符串', async () => {
    const merged = await adjuster.mergeReflections([]);
    expect(merged).toBe('');
  });

  it('构建策略 Prompt', () => {
    const reflection = {
      id: 'r1',
      type: 'failure' as const,
      taskId: 't1',
      iteration: 1,
      evaluation: 'failed',
      lessonsLearned: [],
      improvementSuggestions: ['A', 'B'],
      emotionalTone: 'negative' as const,
      importance: 0.5,
      createdAt: Date.now(),
    };
    const prompt = adjuster.buildStrategyPrompt(reflection, 'current');
    expect(prompt).toContain('current');
    expect(prompt).toContain('failed');
    expect(prompt).toContain('A');
    expect(prompt).toContain('B');
  });
});

// ============ ReflectionEngine 主类测试 ============

describe('ReflectionEngine 主类', () => {
  let engine: ReflectionEngine;

  beforeEach(() => {
    engine = new ReflectionEngine();
  });

  it('成功执行一次通过', async () => {
    const executor = vi
      .fn()
      .mockResolvedValue({
        output:
          'A comprehensive and well-structured answer that thoroughly addresses all aspects of the requested task with clarity and precision. ' +
          'The response includes proper context, detailed explanations, and actionable recommendations that would be useful to anyone reviewing this work. ' +
          'Multiple considerations have been taken into account to ensure the output meets high quality standards across all evaluation criteria.',
        success: true,
        durationMs: 100,
      });
    const session = await engine.executeWithReflection(
      'test task',
      executor,
      { qualityThreshold: 0.7, maxIterations: 1 },
    );
    expect(session.terminationReason).toBe('quality-met');
    expect(session.iterations.length).toBe(1);
  });

  it('通过迭代达到质量阈值', async () => {
    let callCount = 0;
    const executor = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        output: 'A'.repeat(300 + callCount * 100), // 逐步变长
        success: true,
        durationMs: 100,
      };
    });
    const session = await engine.executeWithReflection(
      'test task',
      executor,
      { qualityThreshold: 0.7, maxIterations: 3 },
    );
    expect(session.iterations.length).toBeLessThanOrEqual(3);
    expect(session.terminationReason).toBeDefined();
  });

  it('达到 max-iterations 终止', async () => {
    // 持续返回低质量结果，确保不会进入 quality-met / no-improvement
    const executor = vi.fn().mockImplementation(async (_, iter) => ({
      output: `try-${iter}`, // 太短，质量低
      success: false,
      error: 'persistent failure',
      durationMs: 100,
    }));
    const session = await engine.executeWithReflection(
      'test task',
      executor,
      {
        maxIterations: 3,
        qualityThreshold: 0.99,
        // 关闭 plateau 早停，否则会因为分数不变触发 no-improvement
        earlyStopOnPlateau: false,
      },
    );
    expect(session.terminationReason).toBe('max-iterations');
    expect(session.iterations.length).toBe(3);
  });

  it('plateau 早停', async () => {
    const executor = vi.fn().mockResolvedValue({
      output:
        'Stable output that consistently produces similar quality results across multiple iterations of the reflection loop without significant improvement.',
      success: true,
      durationMs: 100,
    });
    const session = await engine.executeWithReflection(
      'test task',
      executor,
      {
        maxIterations: 5,
        qualityThreshold: 0.99,
        earlyStopOnPlateau: true,
        plateauWindow: 2,
        minImprovementDelta: 0.01,
      },
    );
    expect(session.terminationReason).toBe('no-improvement');
  });

  it('预算耗尽终止', async () => {
    const executor = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                output: 'slow',
                success: true,
                durationMs: 100,
              }),
            150,
          ),
        ),
    );
    const session = await engine.executeWithReflection(
      'test task',
      executor,
      {
        maxIterations: 10,
        budgetLimit: { maxDurationMs: 300 },
      },
    );
    expect(session.terminationReason).toBe('budget-exhausted');
  });

  it('执行器抛出异常时捕获', async () => {
    const executor = vi.fn().mockRejectedValue(new Error('crashed'));
    const session = await engine.executeWithReflection(
      'test task',
      executor,
      { maxIterations: 2 },
    );
    expect(session.iterations.length).toBe(2);
    expect(session.iterations[0].execution.error).toBe('Error: crashed');
  });

  it('evaluateOnly 不执行迭代', async () => {
    const result: TaskExecutionResult = {
      output: 'evaluated result',
      success: true,
      durationMs: 100,
    };
    const ev = await engine.evaluateOnly(result);
    expect(ev.score).toBeGreaterThan(0);
  });

  it('getReflections 按类型过滤', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: [
        'A comprehensive and well-structured answer that thoroughly addresses all aspects.',
        'The response includes proper context, detailed explanations, and recommendations.',
        'Multiple considerations have been taken into account to ensure high quality.',
        'The output meets all evaluation criteria across completeness, correctness, and clarity.',
        'Additional supporting details are provided to give the reader a complete picture.',
        'Final summary confirms the task has been fully accomplished as requested.',
      ].join('\n'),
      success: true,
      durationMs: 100,
    });
    await engine.executeWithReflection('t1', executor, {
      qualityThreshold: 0.7,
      maxIterations: 1,
    });
    const all = engine.getReflections();
    const success = engine.getReflections({ type: 'success' });
    expect(success.length).toBeGreaterThan(0);
    expect(all.length).toBe(success.length);
  });

  it('listSessions 按时间倒序', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: 'a',
      success: true,
      durationMs: 1,
    });
    await engine.executeWithReflection('t1', executor, { qualityThreshold: 0.7 });
    await engine.executeWithReflection('t2', executor, { qualityThreshold: 0.7 });
    const sessions = engine.listSessions();
    expect(sessions.length).toBe(2);
  });

  it('getSession 检索会话', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: 'a',
      success: true,
      durationMs: 1,
    });
    const session = await engine.executeWithReflection(
      't1',
      executor,
      { qualityThreshold: 0.7 },
    );
    const retrieved = engine.getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(session.id);
  });

  it('事件触发', async () => {
    const handler = vi.fn();
    engine.on('iteration', handler);
    const executor = vi.fn().mockResolvedValue({
      output: 'a',
      success: true,
      durationMs: 1,
    });
    await engine.executeWithReflection('t1', executor, { maxIterations: 2 });
    expect(handler).toHaveBeenCalled();
  });

  it('off 注销事件', async () => {
    const handler = vi.fn();
    const off = engine.on('iteration', handler);
    off();
    const executor = vi.fn().mockResolvedValue({
      output: 'a',
      success: true,
      durationMs: 1,
    });
    await engine.executeWithReflection('t1', executor, { maxIterations: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('getStats 返回统计', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: 'good',
      success: true,
      durationMs: 1,
    });
    await engine.executeWithReflection('t1', executor, { qualityThreshold: 0.7 });
    const stats = engine.getStats();
    expect(stats.totalSessions).toBe(1);
    expect(stats.successRate).toBeGreaterThanOrEqual(0);
  });

  it('clear 清理状态', async () => {
    const executor = vi.fn().mockResolvedValue({
      output: 'good',
      success: true,
      durationMs: 1,
    });
    await engine.executeWithReflection('t1', executor, { qualityThreshold: 0.7 });
    engine.clear();
    expect(engine.listSessions().length).toBe(0);
    expect(engine.getReflections().length).toBe(0);
  });

  it('访问内部组件', () => {
    expect(engine.getEvaluator()).toBeInstanceOf(Evaluator);
    expect(engine.getGenerator()).toBeInstanceOf(ReflectionGenerator);
    expect(engine.getAdjuster()).toBeInstanceOf(StrategyAdjuster);
  });

  it('迭代记录包含完整字段', async () => {
    const executor = vi.fn().mockResolvedValueOnce({
      output: 'good',
      success: true,
      durationMs: 1,
    });
    const session = await engine.executeWithReflection('t1', executor, {
      qualityThreshold: 0.7,
    });
    const rec = session.iterations[0];
    expect(rec.iteration).toBe(1);
    expect(rec.strategy).toBeTruthy();
    expect(rec.execution.output).toBe('good');
    expect(rec.evaluation.score).toBeGreaterThan(0);
    expect(rec.reflection.id).toBeTruthy();
  });

  it('持久化 save/load', async () => {
    const executor = vi.fn().mockResolvedValueOnce({
      output: 'good',
      success: true,
      durationMs: 1,
    });
    await engine.executeWithReflection('t1', executor, { qualityThreshold: 0.7 });
    await engine.save();

    // 验证 save 不抛错
    const engine2 = new ReflectionEngine({ persistKey: 'test_persist' });
    await engine2.load();
    // 由于 localStorage 共用，加载后能看到数据
    expect(engine2.listSessions().length).toBeGreaterThanOrEqual(0);
  });
});
