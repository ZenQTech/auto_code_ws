/**
 * # ============================================================
 * # CandidateLearningEngine 单元测试 (Cycle 23 G23-01)
 * # ============================================================
 * # 测试覆盖：
 * #   1. 引擎构造与单例管理
 * #   2. 记录决策 (recordDecision)
 * #   3. 偏好学习与更新 (updatePreferences)
 * #   4. 应用偏好调整评分 (applyPreferences)
 * #   5. 反馈学习 (submitFeedback)
 * #   6. 统计信息 (getStats)
 * #   7. 偏好重置 (resetPreferences)
 * #   8. 配置管理 (updateConfig / getConfig)
 * #   9. 事件订阅 (on)
 * #  10. 存储交互
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  CandidateLearningEngine,
  getCandidateLearningEngine,
  resetCandidateLearningEngine,
  setCandidateLearningEngine,
  isCandidateLearningEngineInitialized,
  type AdjustedScore,
} from './candidateLearning';

// 提供一个 mock 内存存储
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) { return this.store.get(k) ?? null; }
  setItem(k: string, v: string) { this.store.set(k, v); }
  removeItem(k: string) { this.store.delete(k); }
  clear() { this.store.clear(); }
  get length() { return this.store.size; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
}

beforeEach(() => {
  // 每次测试都重置 localStorage，避免测试间状态污染
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      (globalThis.localStorage as Storage).clear();
    } catch {
      // ignore
    }
  } else {
    Object.defineProperty(globalThis, 'localStorage', {
      value: new MemoryStorage(),
      writable: true,
      configurable: true,
    });
  }
  resetCandidateLearningEngine();
});

afterEach(() => {
  resetCandidateLearningEngine();
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      (globalThis.localStorage as Storage).clear();
    } catch {
      // ignore
    }
  }
});

describe('CandidateLearningEngine - 基础构造与单例', () => {
  it('应能创建实例', () => {
    const engine = new CandidateLearningEngine();
    expect(engine).toBeInstanceOf(CandidateLearningEngine);
  });

  it('默认配置应正确', () => {
    const engine = new CandidateLearningEngine();
    const config = engine.getConfig();
    expect(config.algorithm).toBe('weighted');
    expect(config.learningRate).toBe(0.3);
    expect(config.preferenceWeight).toBe(0.4);
    expect(config.maxRecords).toBe(200);
  });

  it('应能接受自定义配置', () => {
    const engine = new CandidateLearningEngine(undefined, {
      algorithm: 'bayesian',
      learningRate: 0.5,
    });
    const config = engine.getConfig();
    expect(config.algorithm).toBe('bayesian');
    expect(config.learningRate).toBe(0.5);
    // 未指定的字段应保留默认
    expect(config.preferenceWeight).toBe(0.4);
  });

  it('单例工厂应返回同一实例', () => {
    const a = getCandidateLearningEngine();
    const b = getCandidateLearningEngine();
    expect(a).toBe(b);
  });

  it('isCandidateLearningEngineInitialized 应正确反映单例状态', () => {
    expect(isCandidateLearningEngineInitialized()).toBe(false);
    getCandidateLearningEngine();
    expect(isCandidateLearningEngineInitialized()).toBe(true);
    resetCandidateLearningEngine();
    expect(isCandidateLearningEngineInitialized()).toBe(false);
  });

  it('setCandidateLearningEngine 应能设置自定义实例', () => {
    const engine = new CandidateLearningEngine();
    setCandidateLearningEngine(engine);
    expect(getCandidateLearningEngine()).toBe(engine);
  });
});

describe('CandidateLearningEngine - 记录决策', () => {
  it('应能记录一次决策', () => {
    const engine = new CandidateLearningEngine();
    const record = engine.recordDecision({
      sessionId: 'sess-1',
      taskType: 'coding',
      prompt: '实现一个 TypeScript 函数',
      candidates: [
        { modelId: 'claude-sonnet-4.5', originalScore: 85 },
        { modelId: 'gpt-5', originalScore: 80 },
      ],
      selectedModelId: 'claude-sonnet-4.5',
    });
    expect(record.recordId).toBeDefined();
    expect(record.sessionId).toBe('sess-1');
    expect(record.taskType).toBe('coding');
    expect(record.selectedModelId).toBe('claude-sonnet-4.5');
    expect(record.promptKeywords).toBeInstanceOf(Array);
  });

  it('应能通过 getRecords 获取所有记录', () => {
    const engine = new CandidateLearningEngine();
    engine.recordDecision({
      sessionId: 'sess-1',
      taskType: 'coding',
      prompt: 'test',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    engine.recordDecision({
      sessionId: 'sess-2',
      taskType: 'writing',
      prompt: 'write',
      candidates: [{ modelId: 'm2', originalScore: 90 }],
      selectedModelId: 'm2',
    });
    expect(engine.getRecords().length).toBe(2);
  });

  it('超过 maxRecords 时应触发 FIFO 裁剪', () => {
    const engine = new CandidateLearningEngine(undefined, { maxRecords: 2 });
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p1',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    engine.recordDecision({
      sessionId: 's2',
      taskType: 'coding',
      prompt: 'p2',
      candidates: [{ modelId: 'm2', originalScore: 80 }],
      selectedModelId: 'm2',
    });
    engine.recordDecision({
      sessionId: 's3',
      taskType: 'coding',
      prompt: 'p3',
      candidates: [{ modelId: 'm3', originalScore: 80 }],
      selectedModelId: 'm3',
    });
    expect(engine.getRecords().length).toBe(2);
    expect(engine.getRecords()[0].sessionId).toBe('s2');
  });

  it('应触发 decision-recorded 事件', () => {
    const engine = new CandidateLearningEngine();
    const handler = vi.fn();
    engine.on('decision-recorded', handler);
    engine.recordDecision({
      sessionId: 'sess-1',
      taskType: 'coding',
      prompt: 'test',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('应能正确标记 selected 字段', () => {
    const engine = new CandidateLearningEngine();
    const record = engine.recordDecision({
      sessionId: 'sess-1',
      taskType: 'coding',
      prompt: 'test',
      candidates: [
        { modelId: 'm1', originalScore: 80 },
        { modelId: 'm2', originalScore: 70 },
      ],
      selectedModelId: 'm1',
    });
    const m1 = record.candidates.find((c) => c.modelId === 'm1');
    const m2 = record.candidates.find((c) => c.modelId === 'm2');
    expect(m1?.selected).toBe(true);
    expect(m2?.selected).toBe(false);
  });
});

describe('CandidateLearningEngine - 偏好学习', () => {
  it('应更新被选模型的偏好权重', () => {
    const engine = new CandidateLearningEngine(undefined, { learningRate: 0.5 });
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [
        { modelId: 'm1', originalScore: 80 },
        { modelId: 'm2', originalScore: 70 },
      ],
      selectedModelId: 'm1',
    });
    const prefs = engine.getPreferences();
    expect(prefs.modelPreferences['m1']).toBeGreaterThan(0);
    // m2 不应被选中，所以权重应被衰减
    expect(prefs.modelPreferences['m2']).toBe(0);
  });

  it('totalDecisions 应递增', () => {
    const engine = new CandidateLearningEngine();
    expect(engine.getPreferences().totalDecisions).toBe(0);
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    expect(engine.getPreferences().totalDecisions).toBe(1);
    engine.recordDecision({
      sessionId: 's2',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    expect(engine.getPreferences().totalDecisions).toBe(2);
  });

  it('权重应限制在 [0, 1] 之间', () => {
    const engine = new CandidateLearningEngine(undefined, { learningRate: 1.0 });
    for (let i = 0; i < 10; i++) {
      engine.recordDecision({
        sessionId: `s${i}`,
        taskType: 'coding',
        prompt: 'p',
        candidates: [{ modelId: 'm1', originalScore: 80 }],
        selectedModelId: 'm1',
      });
    }
    const prefs = engine.getPreferences();
    expect(prefs.modelPreferences['m1']).toBeLessThanOrEqual(1);
    expect(prefs.modelPreferences['m1']).toBeGreaterThanOrEqual(0);
  });

  it('应触发 preference-updated 事件', () => {
    const engine = new CandidateLearningEngine();
    const handler = vi.fn();
    engine.on('preference-updated', handler);
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    expect(handler).toHaveBeenCalled();
  });
});

describe('CandidateLearningEngine - 应用偏好', () => {
  it('应返回按调整后评分降序的结果', () => {
    const engine = new CandidateLearningEngine();
    // 给 m1 一些偏好
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [
        { modelId: 'm1', originalScore: 80 },
        { modelId: 'm2', originalScore: 80 },
      ],
      selectedModelId: 'm1',
    });

    const result = engine.applyPreferences([
      { candidateId: 'c1', modelId: 'm1', baseScore: 0.5 },
      { candidateId: 'c2', modelId: 'm2', baseScore: 0.5 },
    ]);
    // m1 偏好加成 > m2，所以 m1 排第一
    expect(result[0].modelId).toBe('m1');
    expect(result[0].adjustedScore).toBeGreaterThan(result[1].adjustedScore);
  });

  it('返回的对象应包含所有 AdjustedScore 字段', () => {
    const engine = new CandidateLearningEngine();
    const result = engine.applyPreferences([
      { candidateId: 'c1', modelId: 'm1', baseScore: 0.5 },
    ]);
    expect(result.length).toBe(1);
    const item: AdjustedScore = result[0];
    expect(item.candidateId).toBe('c1');
    expect(item.modelId).toBe('m1');
    expect(typeof item.baseScore).toBe('number');
    expect(typeof item.preferenceBoost).toBe('number');
    expect(typeof item.originalScore).toBe('number');
    expect(typeof item.adjustedScore).toBe('number');
    expect(typeof item.finalScore).toBe('number');
    expect(item.reasons).toBeInstanceOf(Array);
    expect(item.explanation).toBeDefined();
  });

  it('新模型应标记为"新模型（无历史偏好）"', () => {
    const engine = new CandidateLearningEngine();
    const result = engine.applyPreferences([
      { candidateId: 'c1', modelId: 'unknown-model', baseScore: 0.5 },
    ]);
    expect(result[0].reasons.some((r) => r.includes('新模型'))).toBe(true);
  });

  it('高偏好模型应标记为"高偏好模型"', () => {
    const engine = new CandidateLearningEngine();
    // 多次记录 m1 被选中
    for (let i = 0; i < 5; i++) {
      engine.recordDecision({
        sessionId: `s${i}`,
        taskType: 'coding',
        prompt: 'p',
        candidates: [{ modelId: 'm1', originalScore: 80 }],
        selectedModelId: 'm1',
      });
    }
    const result = engine.applyPreferences([
      { candidateId: 'c1', modelId: 'm1', baseScore: 0.5 },
    ]);
    expect(result[0].reasons.some((r) => r.includes('高偏好'))).toBe(true);
  });

  it('adjustedScore 应在 [0, 1] 范围内', () => {
    const engine = new CandidateLearningEngine(undefined, { preferenceWeight: 1.0 });
    // 制造一个高偏好
    for (let i = 0; i < 5; i++) {
      engine.recordDecision({
        sessionId: `s${i}`,
        taskType: 'coding',
        prompt: 'p',
        candidates: [{ modelId: 'm1', originalScore: 100 }],
        selectedModelId: 'm1',
      });
    }
    const result = engine.applyPreferences([
      { candidateId: 'c1', modelId: 'm1', baseScore: 0.9 },
    ]);
    expect(result[0].adjustedScore).toBeGreaterThanOrEqual(0);
    expect(result[0].adjustedScore).toBeLessThanOrEqual(1);
  });
});

describe('CandidateLearningEngine - 反馈学习', () => {
  it('正面反馈应增加被选模型权重', () => {
    const engine = new CandidateLearningEngine(undefined, { learningRate: 0.3 });
    const record = engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    const before = engine.getPreferences().modelPreferences['m1'];
    engine.submitFeedback(record.recordId, 'positive');
    const after = engine.getPreferences().modelPreferences['m1'];
    expect(after).toBeGreaterThan(before);
  });

  it('负面反馈应降低被选模型权重', () => {
    const engine = new CandidateLearningEngine();
    const record = engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    const before = engine.getPreferences().modelPreferences['m1'];
    engine.submitFeedback(record.recordId, 'negative');
    const after = engine.getPreferences().modelPreferences['m1'];
    expect(after).toBeLessThan(before);
  });

  it('中性反馈不应改变权重', () => {
    const engine = new CandidateLearningEngine();
    const record = engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    const before = engine.getPreferences().modelPreferences['m1'];
    engine.submitFeedback(record.recordId, 'neutral');
    const after = engine.getPreferences().modelPreferences['m1'];
    expect(after).toBe(before);
  });

  it('不存在的 recordId 应被静默忽略', () => {
    const engine = new CandidateLearningEngine();
    expect(() => engine.submitFeedback('non-existent', 'positive')).not.toThrow();
  });

  it('应触发 feedback-submitted 事件', () => {
    const engine = new CandidateLearningEngine();
    const record = engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    const handler = vi.fn();
    engine.on('feedback-submitted', handler);
    engine.submitFeedback(record.recordId, 'positive');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'feedback-submitted',
        data: expect.objectContaining({ feedback: 'positive' }),
      })
    );
  });

  it('feedback 字段应正确设置到记录上', () => {
    const engine = new CandidateLearningEngine();
    const record = engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    engine.submitFeedback(record.recordId, 'positive');
    const records = engine.getRecords();
    expect(records[0].feedback).toBe('positive');
  });
});

describe('CandidateLearningEngine - 统计', () => {
  it('空引擎应返回零统计', () => {
    const engine = new CandidateLearningEngine();
    const stats = engine.getStats();
    expect(stats.totalRecords).toBe(0);
    expect(stats.totalFeedback).toBe(0);
    expect(stats.acceptanceRate).toBe(0);
    expect(stats.topModel).toBeNull();
    expect(stats.topTaskType).toBeNull();
  });

  it('topModel 应是权重最高的模型', () => {
    const engine = new CandidateLearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.recordDecision({
        sessionId: `s${i}`,
        taskType: 'coding',
        prompt: 'p',
        candidates: [{ modelId: 'top-model', originalScore: 80 }],
        selectedModelId: 'top-model',
      });
    }
    const stats = engine.getStats();
    expect(stats.topModel).toBe('top-model');
  });

  it('topTaskType 应是权重最高的任务类型', () => {
    const engine = new CandidateLearningEngine();
    for (let i = 0; i < 5; i++) {
      engine.recordDecision({
        sessionId: `s${i}`,
        taskType: 'writing',
        prompt: 'p',
        candidates: [{ modelId: 'm1', originalScore: 80 }],
        selectedModelId: 'm1',
      });
    }
    const stats = engine.getStats();
    expect(stats.topTaskType).toBe('writing');
  });

  it('acceptanceRate 应正确计算', () => {
    const engine = new CandidateLearningEngine();
    const r1 = engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    const r2 = engine.recordDecision({
      sessionId: 's2',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm2', originalScore: 80 }],
      selectedModelId: 'm2',
    });
    engine.submitFeedback(r1.recordId, 'positive');
    engine.submitFeedback(r2.recordId, 'negative');
    const stats = engine.getStats();
    expect(stats.acceptanceRate).toBe(0.5);
  });

  it('preferenceStrength 应是平均权重', () => {
    const engine = new CandidateLearningEngine();
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [
        { modelId: 'm1', originalScore: 80 },
        { modelId: 'm2', originalScore: 80 },
      ],
      selectedModelId: 'm1',
    });
    const stats = engine.getStats();
    expect(stats.preferenceStrength).toBeGreaterThan(0);
  });
});

describe('CandidateLearningEngine - 重置与管理', () => {
  it('resetPreferences 应清空所有数据和偏好', () => {
    const engine = new CandidateLearningEngine();
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    engine.resetPreferences();
    expect(engine.getRecords().length).toBe(0);
    expect(engine.getPreferences().totalDecisions).toBe(0);
  });

  it('updateConfig 应合并新配置', () => {
    const engine = new CandidateLearningEngine();
    engine.updateConfig({ learningRate: 0.8 });
    const config = engine.getConfig();
    expect(config.learningRate).toBe(0.8);
    // 其它字段应保留
    expect(config.algorithm).toBe('weighted');
  });

  it('updateConfig 应触发 config-updated 事件', () => {
    const engine = new CandidateLearningEngine();
    const handler = vi.fn();
    engine.on('config-updated', handler);
    engine.updateConfig({ learningRate: 0.8 });
    expect(handler).toHaveBeenCalled();
  });

  it('getConfig 应返回配置副本（防止外部修改）', () => {
    const engine = new CandidateLearningEngine();
    const config = engine.getConfig();
    config.learningRate = 999;
    expect(engine.getConfig().learningRate).toBe(0.3);
  });
});

describe('CandidateLearningEngine - 事件订阅', () => {
  it('on() 应返回取消订阅函数', () => {
    const engine = new CandidateLearningEngine();
    const handler = vi.fn();
    const unsub = engine.on('decision-recorded', handler);
    expect(typeof unsub).toBe('function');
    unsub();
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('事件 handler 异常不应影响其他 handler', () => {
    const engine = new CandidateLearningEngine();
    const errorHandler = () => {
      throw new Error('handler error');
    };
    const okHandler = vi.fn();
    engine.on('decision-recorded', errorHandler);
    engine.on('decision-recorded', okHandler);
    expect(() => {
      engine.recordDecision({
        sessionId: 's1',
        taskType: 'coding',
        prompt: 'p',
        candidates: [{ modelId: 'm1', originalScore: 80 }],
        selectedModelId: 'm1',
      });
    }).not.toThrow();
    expect(okHandler).toHaveBeenCalled();
  });
});

describe('CandidateLearningEngine - 存储', () => {
  it('使用自定义存储应能正确持久化', () => {
    const memStorage = new MemoryStorage();
    // 模拟 localStorage 用于直接访问
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = memStorage;
    const engine = new CandidateLearningEngine();
    engine.recordDecision({
      sessionId: 's1',
      taskType: 'coding',
      prompt: 'p',
      candidates: [{ modelId: 'm1', originalScore: 80 }],
      selectedModelId: 'm1',
    });
    // 验证 localStorage 有数据
    expect(memStorage.length).toBeGreaterThan(0);
  });

  it('load() 应从 storage 恢复数据', () => {
    // 先写入数据
    const data = {
      records: [{
        recordId: 'r1',
        sessionId: 's1',
        taskType: 'coding' as const,
        promptKeywords: [],
        candidates: [],
        selectedModelId: 'm1',
        createdAt: Date.now(),
      }],
      preferences: {
        userId: 'default-user',
        modelPreferences: { m1: 0.5 },
        taskPreferences: { coding: 0.3, writing: 0, analysis: 0, learning: 0, general: 0 },
        totalDecisions: 1,
        lastUpdated: Date.now(),
      },
    };
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
    (globalThis as unknown as { localStorage: MemoryStorage }).localStorage.setItem('hermes.candidateLearning', JSON.stringify(data));
    const engine = new CandidateLearningEngine();
    expect(engine.getRecords().length).toBe(1);
    expect(engine.getPreferences().modelPreferences['m1']).toBe(0.5);
  });
});
