/**
 * # ============================================================
 * # MultimodalRAGE2ETestSuite 单元测试 (Cycle 50 G50-02)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  MultimodalRAGE2ETestSuite,
  createE2ETestSuite,
  createEcommerceScenario,
  createKnowledgeBaseScenario,
  createHybridSearchScenario,
  createCacheStressScenario,
  type E2EScenario,
  type E2EEvent,
} from './multimodalRAGE2ETestSuite';

describe('MultimodalRAGE2ETestSuite - 内置场景', () => {
  it('应创建电商场景', () => {
    const s = createEcommerceScenario();
    expect(s.id).toBe('ecommerce-product-search');
    expect(s.documents.length).toBeGreaterThan(0);
    expect(s.queries.length).toBeGreaterThan(0);
  });

  it('应创建知识库场景', () => {
    const s = createKnowledgeBaseScenario();
    expect(s.id).toBe('knowledge-base-qa');
    expect(s.documents.length).toBeGreaterThan(0);
  });

  it('应创建混合搜索场景', () => {
    const s = createHybridSearchScenario();
    expect(s.id).toBe('hybrid-search');
    expect(s.queries.some((q) => q.modality === 'multimodal')).toBe(true);
  });

  it('应创建缓存压力场景', () => {
    const s = createCacheStressScenario();
    expect(s.queries.length).toBe(20);
  });
});

describe('MultimodalRAGE2ETestSuite - 套件创建', () => {
  it('createE2ETestSuite 应返回实例', () => {
    const suite = createE2ETestSuite();
    expect(suite).toBeInstanceOf(MultimodalRAGE2ETestSuite);
  });

  it('应能自定义 K', () => {
    const suite = new MultimodalRAGE2ETestSuite({ k: 10 });
    expect(suite).toBeInstanceOf(MultimodalRAGE2ETestSuite);
  });
});

describe('MultimodalRAGE2ETestSuite - 运行场景', () => {
  it('应能运行电商场景', async () => {
    const suite = createE2ETestSuite();
    const report = await suite.runAll();
    expect(report.scenarios.length).toBe(4);
    expect(report.summary.totalQueries).toBeGreaterThan(0);
  }, 30000);

  it('应能运行知识库场景', async () => {
    const suite = createE2ETestSuite({ scenarios: [createKnowledgeBaseScenario()] });
    const report = await suite.runAll();
    expect(report.scenarios.length).toBe(1);
    expect(report.summary.totalQueries).toBe(6);
  }, 30000);

  it('运行所有场景应有完整汇总', async () => {
    const suite = createE2ETestSuite();
    const report = await suite.runAll();
    expect(report.summary.totalScenarios).toBe(4);
    expect(report.summary.avgP95LatencyMs).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('场景 ID 应唯一', async () => {
    const suite = createE2ETestSuite();
    const report = await suite.runAll();
    const ids = report.scenarios.map((s) => s.scenarioId);
    expect(new Set(ids).size).toBe(ids.length);
  }, 30000);
});

describe('MultimodalRAGE2ETestSuite - 指标计算', () => {
  it('Recall@K 应在 0-1 之间', async () => {
    const suite = createE2ETestSuite({ scenarios: [createEcommerceScenario()] });
    const report = await suite.runAll();
    const s = report.scenarios[0]!;
    expect(s.metrics.recallAtK).toBeGreaterThanOrEqual(0);
    expect(s.metrics.recallAtK).toBeLessThanOrEqual(1);
  }, 30000);

  it('缓存命中率应 >= 0', async () => {
    const suite = createE2ETestSuite({ scenarios: [createCacheStressScenario()] });
    const report = await suite.runAll();
    expect(report.scenarios[0]!.metrics.cacheHitRate).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('P95 延迟应 >= P50 延迟', async () => {
    const suite = createE2ETestSuite({ scenarios: [createEcommerceScenario()] });
    const report = await suite.runAll();
    const s = report.scenarios[0]!;
    expect(s.metrics.p95LatencyMs).toBeGreaterThanOrEqual(s.metrics.p50LatencyMs);
  }, 30000);

  it('平均延迟应 >= 0', async () => {
    const suite = createE2ETestSuite({ scenarios: [createKnowledgeBaseScenario()] });
    const report = await suite.runAll();
    expect(report.scenarios[0]!.metrics.avgLatencyMs).toBeGreaterThanOrEqual(0);
  }, 30000);
});

describe('MultimodalRAGE2ETestSuite - 期望验证', () => {
  it('高阈值应导致失败', async () => {
    const scenario: E2EScenario = {
      ...createEcommerceScenario(),
      expectations: { minRecallAtK: 2 }, // 不可能达到 (recall 上限为 1)
    };
    const suite = createE2ETestSuite({ scenarios: [scenario] });
    const report = await suite.runAll();
    expect(report.scenarios[0]!.passed).toBe(false);
    expect(report.scenarios[0]!.failures.length).toBeGreaterThan(0);
  }, 30000);

  it('实际可达到的阈值应通过', async () => {
    const scenario: E2EScenario = {
      ...createEcommerceScenario(),
      expectations: { minRecallAtK: 0, maxP95LatencyMs: 10000 },
    };
    const suite = createE2ETestSuite({ scenarios: [scenario] });
    const report = await suite.runAll();
    expect(report.scenarios[0]!.passed).toBe(true);
    expect(report.scenarios[0]!.failures).toEqual([]);
  }, 30000);
});

describe('MultimodalRAGE2ETestSuite - 事件订阅', () => {
  it('应能订阅事件', async () => {
    const suite = createE2ETestSuite({ scenarios: [createEcommerceScenario()] });
    const events: E2EEvent[] = [];
    const unsub = suite.subscribe((e) => events.push(e));
    await suite.runAll();
    expect(events.length).toBeGreaterThan(0);
    unsub();
  }, 30000);

  it('退订后应不再接收', async () => {
    const suite = createE2ETestSuite({ scenarios: [createEcommerceScenario()] });
    const events: E2EEvent[] = [];
    const unsub = suite.subscribe((e) => events.push(e));
    await suite.runAll();
    const len = events.length;
    unsub();
    await suite.runAll();
    expect(events.length).toBe(len);
  }, 60000);
});

describe('MultimodalRAGE2ETestSuite - 报告导出', () => {
  it('应能导出 Markdown', async () => {
    const suite = createE2ETestSuite({ scenarios: [createEcommerceScenario()] });
    const report = await suite.runAll();
    const md = suite.exportMarkdown(report);
    expect(md).toContain('# Multimodal RAG E2E Test Suite');
    expect(md).toContain('## 汇总');
    expect(md).toContain('Recall@K');
  }, 30000);

  it('应能导出 JSON', async () => {
    const suite = createE2ETestSuite({ scenarios: [createEcommerceScenario()] });
    const report = await suite.runAll();
    const json = suite.exportJson(report);
    expect(() => JSON.parse(json)).not.toThrow();
  }, 30000);

  it('失败场景应包含在 Markdown 中', async () => {
    const scenario: E2EScenario = {
      ...createEcommerceScenario(),
      expectations: { minRecallAtK: 2 }, // 强制失败
    };
    const suite = createE2ETestSuite({ scenarios: [scenario] });
    const report = await suite.runAll();
    const md = suite.exportMarkdown(report);
    expect(md).toContain('❌');
  }, 30000);
});

describe('MultimodalRAGE2ETestSuite - 边界条件', () => {
  it('空场景应能处理', async () => {
    const suite = createE2ETestSuite({ scenarios: [] });
    const report = await suite.runAll();
    expect(report.summary.totalScenarios).toBe(0);
  }, 10000);

  it('空文档集应能处理', async () => {
    const scenario: E2EScenario = {
      id: 'empty-docs',
      name: '空文档',
      description: '测试空场景',
      documents: [],
      queries: [{ id: 'q1', modality: 'text', text: 'a', expectedDocIds: [] }],
      expectations: {},
    };
    const suite = createE2ETestSuite({ scenarios: [scenario] });
    const report = await suite.runAll();
    expect(report.scenarios[0]!.metrics.recallAtK).toBe(0);
  }, 30000);
});

describe('MultimodalRAGE2ETestSuite - 性能基准', () => {
  it('电商场景应在 30s 内完成', async () => {
    const suite = createE2ETestSuite({ scenarios: [createEcommerceScenario()] });
    const start = Date.now();
    await suite.runAll();
    expect(Date.now() - start).toBeLessThan(30000);
  }, 30000);

  it('知识库场景应在 30s 内完成', async () => {
    const suite = createE2ETestSuite({ scenarios: [createKnowledgeBaseScenario()] });
    const start = Date.now();
    await suite.runAll();
    expect(Date.now() - start).toBeLessThan(30000);
  }, 30000);

  it('缓存压力场景 P95 延迟应 < 100ms', async () => {
    const suite = createE2ETestSuite({ scenarios: [createCacheStressScenario()] });
    const report = await suite.runAll();
    expect(report.scenarios[0]!.metrics.p95LatencyMs).toBeLessThan(100);
  }, 30000);
});
