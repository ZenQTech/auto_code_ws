/**
 * ModelRouter 单元测试 (v1.0.0 Cycle 20 G20-02)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModelRouter,
  getModelRouter,
  resetModelRouter,
  isModelRouterInitialized,
  classifyTask,
  estimateComplexity,
  scoreModel,
  DEFAULT_MODELS,
  type ModelInfo,
} from './modelRouter';

describe('classifyTask', () => {
  it('分类为 code_generation', () => {
    expect(classifyTask('请帮我实现一个 React 组件')).toBe('code_generation');
    expect(classifyTask('Create a function to parse CSV')).toBe('code_generation');
  });

  it('分类为 code_review', () => {
    expect(classifyTask('请审查这段代码')).toBe('code_review');
    expect(classifyTask('Review my code please')).toBe('code_review');
  });

  it('分类为 debugging', () => {
    expect(classifyTask('帮我调试这个 bug')).toBe('debugging');
    expect(classifyTask('Fix this error in the function')).toBe('debugging');
  });

  it('分类为 documentation', () => {
    expect(classifyTask('生成 API 文档')).toBe('documentation');
    expect(classifyTask('Write README')).toBe('documentation');
  });

  it('分类为 translation', () => {
    expect(classifyTask('翻译成英文')).toBe('translation');
    expect(classifyTask('Translate to Chinese')).toBe('translation');
  });

  it('分类为 explanation', () => {
    expect(classifyTask('解释这段代码做什么')).toBe('explanation');
    expect(classifyTask('Explain how React works')).toBe('explanation');
  });

  it('分类为 refactoring', () => {
    expect(classifyTask('重构这个组件')).toBe('refactoring');
    expect(classifyTask('Refactor this code')).toBe('refactoring');
  });

  it('分类为 testing', () => {
    expect(classifyTask('写单元测试')).toBe('testing');
    expect(classifyTask('Write integration test')).toBe('testing');
  });

  it('分类为 analysis', () => {
    expect(classifyTask('分析这个算法复杂度')).toBe('analysis');
    expect(classifyTask('Compare two approaches')).toBe('analysis');
  });

  it('分类为 brainstorm', () => {
    expect(classifyTask('头脑风暴：有什么好的方案')).toBe('brainstorm');
    expect(classifyTask('Brainstorm ideas')).toBe('brainstorm');
  });

  it('未知任务返回 unknown', () => {
    expect(classifyTask('xyz random text')).toBe('unknown');
  });

  it('空 prompt 返回 unknown', () => {
    expect(classifyTask('')).toBe('unknown');
  });

  it('null prompt 返回 unknown', () => {
    expect(classifyTask(null as unknown as string)).toBe('unknown');
  });
});

describe('estimateComplexity', () => {
  it('短 prompt 复杂度为 1', () => {
    expect(estimateComplexity('short')).toBe(1);
  });

  it('中等 prompt', () => {
    const medium = 'a'.repeat(800);
    expect(estimateComplexity(medium)).toBeGreaterThanOrEqual(2);
  });

  it('长 prompt 复杂度 >= 5', () => {
    const long = 'a'.repeat(6000);
    expect(estimateComplexity(long)).toBeGreaterThanOrEqual(4);
  });

  it('文件数影响复杂度', () => {
    expect(estimateComplexity('a', { fileCount: 10 })).toBeGreaterThan(1);
    expect(estimateComplexity('a', { fileCount: 30 })).toBeGreaterThanOrEqual(3);
  });

  it('外部依赖影响复杂度', () => {
    expect(estimateComplexity('a', { externalDependencies: 5 })).toBeGreaterThan(1);
  });

  it('嵌套层级影响复杂度', () => {
    expect(estimateComplexity('a', { nestingLevel: 5 })).toBeGreaterThan(1);
  });

  it('最大复杂度不超过 10', () => {
    const long = 'a'.repeat(10000);
    expect(estimateComplexity(long, { fileCount: 50, contextTokens: 100000, nestingLevel: 10 })).toBeLessThanOrEqual(10);
  });

  it('空 prompt 返回 1', () => {
    expect(estimateComplexity('')).toBe(1);
  });
});

describe('scoreModel', () => {
  const baseModel: ModelInfo = {
    id: 'test-model',
    name: 'Test',
    provider: 'anthropic',
    inputCostPer1k: 0.003,
    outputCostPer1k: 0.015,
    contextWindow: 100000,
    capabilityScore: 8.0,
    speedScore: 7,
    specialties: ['code_generation'],
    enabled: true,
  };

  it('禁用模型得分为 -1', () => {
    const disabled = { ...baseModel, enabled: false };
    expect(scoreModel(disabled, 'code_generation', 5, 'balance').score).toBe(-1);
  });

  it('专业领域加分', () => {
    const specialist = scoreModel(baseModel, 'code_generation', 5, 'balance').score;
    const nonSpecialist = scoreModel(baseModel, 'translation', 5, 'balance').score;
    expect(specialist).toBeGreaterThan(nonSpecialist);
  });

  it('cost 模式倾向低成本', () => {
    const expensive = scoreModel({ ...baseModel, inputCostPer1k: 0.05, outputCostPer1k: 0.1 }, 'code_generation', 5, 'cost').score;
    const cheap = scoreModel({ ...baseModel, inputCostPer1k: 0.0001, outputCostPer1k: 0.0004 }, 'code_generation', 5, 'cost').score;
    expect(cheap).toBeGreaterThan(expensive);
  });

  it('intelligence 模式倾向高能力', () => {
    const high = scoreModel({ ...baseModel, capabilityScore: 9.5 }, 'code_generation', 5, 'intelligence').score;
    const low = scoreModel({ ...baseModel, capabilityScore: 5 }, 'code_generation', 5, 'intelligence').score;
    expect(high).toBeGreaterThan(low);
  });

  it('balance 模式平衡', () => {
    const result = scoreModel(baseModel, 'code_generation', 5, 'balance');
    expect(result.score).toBeGreaterThan(0);
  });

  it('高复杂度倾向高能力', () => {
    const low = scoreModel({ ...baseModel, capabilityScore: 7 }, 'code_generation', 5, 'balance').score;
    const high = scoreModel({ ...baseModel, capabilityScore: 9.5 }, 'code_generation', 8, 'balance').score;
    expect(high).toBeGreaterThan(low);
  });
});

describe('ModelRouter', () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  describe('registerModel', () => {
    it('注册模型', () => {
      const model: ModelInfo = {
        id: 'test',
        name: 'Test',
        provider: 'openai',
        inputCostPer1k: 0.001,
        outputCostPer1k: 0.002,
        contextWindow: 100000,
        capabilityScore: 8,
        speedScore: 8,
        specialties: ['code_generation'],
        enabled: true,
      };
      router.registerModel(model);
      expect(router.getModel('test')).toEqual(model);
    });

    it('拒绝无 id 模型', () => {
      expect(() => router.registerModel({ ...DEFAULT_MODELS[0], id: '' })).toThrow();
    });
  });

  describe('unregisterModel', () => {
    it('注销模型', () => {
      router.registerModel(DEFAULT_MODELS[0]);
      router.unregisterModel(DEFAULT_MODELS[0].id);
      expect(router.getModel(DEFAULT_MODELS[0].id)).toBeNull();
    });
  });

  describe('listModels', () => {
    it('返回所有模型', () => {
      const list = router.listModels();
      expect(list.length).toBeGreaterThan(0);
    });
  });

  describe('setMode / getMode', () => {
    it('默认 balance', () => {
      expect(router.getMode()).toBe('balance');
    });

    it('切换到 cost', () => {
      router.setMode('cost');
      expect(router.getMode()).toBe('cost');
    });

    it('切换到 intelligence', () => {
      router.setMode('intelligence');
      expect(router.getMode()).toBe('intelligence');
    });
  });

  describe('classify', () => {
    it('返回 TaskCategory', () => {
      const result = router.classify('请实现一个函数');
      expect(typeof result).toBe('string');
    });
  });

  describe('estimateComplexity', () => {
    it('返回数字', () => {
      const result = router.estimateComplexity('short prompt');
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(10);
    });
  });

  describe('route', () => {
    it('返回 ModelRoute', () => {
      const route = router.route('请实现一个 React 组件');
      expect(route.model).toBeDefined();
      expect(route.category).toBeDefined();
      expect(route.complexity).toBeGreaterThanOrEqual(1);
      expect(route.candidates.length).toBeGreaterThan(0);
    });

    it('包含 candidates 排序', () => {
      const route = router.route('请写一段代码');
      for (let i = 1; i < route.candidates.length; i++) {
        expect(route.candidates[i - 1].score).toBeGreaterThanOrEqual(route.candidates[i].score);
      }
    });

    it('记录决策日志', () => {
      router.route('test 1');
      router.route('test 2');
      expect(router.getDecisionLog()).toHaveLength(2);
    });

    it('preferred model 优先', () => {
      const route = router.route('test prompt', { preferredModel: 'gemini-2.0-flash' });
      // preferred 应该在 candidates 中得分更高
      const preferredScore = route.candidates.find(c => c.model === 'gemini-2.0-flash')?.score ?? 0;
      const otherScore = route.candidates.find(c => c.model === 'claude-sonnet-4.5')?.score ?? 0;
      expect(preferredScore).toBeGreaterThan(otherScore);
    });

    it('excluded models 被排除', () => {
      const route = router.route('test', { excludedModels: ['claude-sonnet-4.5'] });
      expect(route.candidates.find(c => c.model === 'claude-sonnet-4.5')).toBeUndefined();
    });

    it('使用 context 中的 taskType', () => {
      const route = router.route('unknown', { taskType: 'code_generation' });
      expect(route.category).toBe('code_generation');
    });

    it('拒绝空 prompt', () => {
      expect(() => router.route('')).toThrow();
    });

    it('拒绝 null prompt', () => {
      expect(() => router.route(null as unknown as string)).toThrow();
    });
  });

  describe('getDecisionLog', () => {
    beforeEach(() => {
      router.route('test code generation');
      router.route('test review');
      router.route('test debug');
    });

    it('返回所有决策', () => {
      expect(router.getDecisionLog()).toHaveLength(3);
    });

    it('按 model 过滤', () => {
      const log = router.getDecisionLog();
      const firstModel = log[0].model;
      const filtered = router.getDecisionLog({ model: firstModel });
      filtered.forEach(r => expect(r.model).toBe(firstModel));
    });

    it('按 category 过滤', () => {
      const log = router.getDecisionLog({ category: 'code_generation' });
      log.forEach(r => expect(r.category).toBe('code_generation'));
    });

    it('按 mode 过滤', () => {
      router.setMode('cost');
      router.route('test cost');
      const log = router.getDecisionLog({ mode: 'cost' });
      log.forEach(r => expect(r.mode).toBe('cost'));
    });

    it('按时间过滤', () => {
      const now = Date.now();
      const log = router.getDecisionLog({ sinceMs: now - 1000 });
      expect(log.length).toBeGreaterThan(0);
    });

    it('限制数量', () => {
      const log = router.getDecisionLog({ limit: 1 });
      expect(log).toHaveLength(1);
    });
  });

  describe('clearDecisionLog', () => {
    it('清空决策日志', () => {
      router.route('test');
      router.clearDecisionLog();
      expect(router.getDecisionLog()).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('返回统计', () => {
      router.route('test 1');
      router.route('test 2');
      const stats = router.getStats();
      expect(stats.totalDecisions).toBe(2);
      expect(Object.keys(stats.byModel).length).toBeGreaterThan(0);
    });
  });

  describe('on', () => {
    it('订阅 mode-changed', () => {
      const events: string[] = [];
      router.on('mode-changed', () => events.push('mode-changed'));
      router.setMode('cost');
      expect(events).toContain('mode-changed');
    });

    it('订阅 model-registered', () => {
      const events: string[] = [];
      router.on('model-registered', () => events.push('model-registered'));
      router.registerModel(DEFAULT_MODELS[0]);
      expect(events).toContain('model-registered');
    });

    it('订阅 route-decided', () => {
      const events: number[] = [];
      router.on('route-decided', () => events.push(1));
      router.route('test');
      expect(events).toHaveLength(1);
    });

    it('取消订阅', () => {
      const events: number[] = [];
      const unsub = router.on('mode-changed', () => events.push(1));
      unsub();
      router.setMode('cost');
      expect(events).toHaveLength(0);
    });
  });
});

describe('ModelRouter 单例', () => {
  beforeEach(() => {
    resetModelRouter();
  });

  it('初始化前未定义', () => {
    expect(isModelRouterInitialized()).toBe(false);
  });

  it('首次调用创建实例', () => {
    const r = getModelRouter();
    expect(r).toBeInstanceOf(ModelRouter);
  });

  it('后续调用返回同一实例', () => {
    const a = getModelRouter();
    const b = getModelRouter();
    expect(a).toBe(b);
  });

  it('重置后返回新实例', () => {
    const a = getModelRouter();
    resetModelRouter();
    const b = getModelRouter();
    expect(a).not.toBe(b);
  });
});

describe('DEFAULT_MODELS', () => {
  it('包含 Claude Sonnet 4.5', () => {
    expect(DEFAULT_MODELS.find(m => m.id === 'claude-sonnet-4.5')).toBeDefined();
  });

  it('包含 GPT-5', () => {
    expect(DEFAULT_MODELS.find(m => m.id === 'gpt-5')).toBeDefined();
  });

  it('包含 DeepSeek V3.2', () => {
    expect(DEFAULT_MODELS.find(m => m.id === 'deepseek-v3.2')).toBeDefined();
  });

  it('包含 Gemini 2.0 Flash', () => {
    expect(DEFAULT_MODELS.find(m => m.id === 'gemini-2.0-flash')).toBeDefined();
  });

  it('所有模型均启用', () => {
    DEFAULT_MODELS.forEach(m => expect(m.enabled).toBe(true));
  });
});
