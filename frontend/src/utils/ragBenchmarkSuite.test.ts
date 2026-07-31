/**
 * # ragBenchmarkSuite 单元测试 (v1.0.0 Cycle 47 G47-04)
 * # 测试维度:
 * #   1. 文档/查询生成
 * #   2. 延迟基准测试
 * #   3. 吞吐量基准测试
 * #   4. 缓存基准测试
 * #   5. 回归测试
 * #   6. 综合压测
 * #   7. 内存监控
 * #   8. 报告导出
 * #   9. 工厂函数
 * #   10. 边界情况
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RAGPerformanceBenchmark,
  createPerformanceBenchmark,
  type BenchmarkDocument,
  type BenchmarkQuery,
  type SearchCallback,
  type RAGCallback,
  type LatencyResult,
} from './ragBenchmarkSuite';

describe('RAGPerformanceBenchmark - 文档/查询生成', () => {
  it('应能生成文档语料库', () => {
    const corpus = RAGPerformanceBenchmark.generateCorpus(100);
    expect(corpus.length).toBe(100);
    expect(corpus[0]!.id).toBe('doc-000000');
    expect(corpus[99]!.id).toBe('doc-000099');
  });

  it('文档应包含元数据', () => {
    const corpus = RAGPerformanceBenchmark.generateCorpus(10);
    expect(corpus[0]!.metadata).toBeDefined();
    expect(corpus[0]!.metadata?.topic).toBeDefined();
  });

  it('应支持自定义文档平均长度', () => {
    const corpus = RAGPerformanceBenchmark.generateCorpus(50, { avgDocLength: 1000 });
    const avgLen = corpus.reduce((s, d) => s + d.content.length, 0) / corpus.length;
    expect(avgLen).toBeGreaterThan(100);
  });

  it('应支持自定义 seed (确定性)', () => {
    const corpus1 = RAGPerformanceBenchmark.generateCorpus(20, { seed: 42 });
    const corpus2 = RAGPerformanceBenchmark.generateCorpus(20, { seed: 42 });
    expect(corpus1[0]!.content).toBe(corpus2[0]!.content);
  });

  it('不同 seed 应产生不同内容', () => {
    const corpus1 = RAGPerformanceBenchmark.generateCorpus(20, { seed: 1 });
    const corpus2 = RAGPerformanceBenchmark.generateCorpus(20, { seed: 2 });
    expect(corpus1[0]!.content).not.toBe(corpus2[0]!.content);
  });

  it('应能生成查询', () => {
    const corpus = RAGPerformanceBenchmark.generateCorpus(10);
    const queries = RAGPerformanceBenchmark.generateQueries(50, corpus);
    expect(queries.length).toBe(50);
    expect(queries[0]!.query.length).toBeGreaterThan(0);
  });

  it('查询应包含期望文档', () => {
    const corpus = RAGPerformanceBenchmark.generateCorpus(10);
    const queries = RAGPerformanceBenchmark.generateQueries(20, corpus);
    for (const q of queries) {
      expect(q.expectedTopK?.length).toBe(1);
    }
  });
});

describe('RAGPerformanceBenchmark - 延迟基准测试', () => {
  let benchmark: RAGPerformanceBenchmark;

  beforeEach(() => {
    benchmark = new RAGPerformanceBenchmark();
  });

  it('应能运行延迟基准测试', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 20 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const callback: SearchCallback = async (query, topK) => ({
      resultIds: ['d1', 'd2'],
      durationMs: 50,
    });
    const result = await benchmark.runLatencyBenchmark(queries, callback, 5);
    expect(result.totalQueries).toBe(20);
    expect(result.successQueries).toBe(20);
    expect(result.avgLatencyMs).toBe(50);
  });

  it('应能计算 P50/P95/P99', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 100 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const callback: SearchCallback = async (query, topK) => ({
      resultIds: ['d1'],
      durationMs: Math.random() * 100,
    });
    const result = await benchmark.runLatencyBenchmark(queries, callback, 5);
    expect(result.p50LatencyMs).toBeGreaterThan(0);
    expect(result.p95LatencyMs).toBeGreaterThan(result.p50LatencyMs);
    expect(result.p99LatencyMs).toBeGreaterThanOrEqual(result.p95LatencyMs);
  });

  it('应能计算标准差', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const callback: SearchCallback = async (query, topK) => ({
      resultIds: ['d1'],
      durationMs: 50 + (Math.random() - 0.5) * 20,
    });
    const result = await benchmark.runLatencyBenchmark(queries, callback, 5);
    expect(result.stdDevMs).toBeGreaterThan(0);
  });

  it('应能统计失败数', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    let count = 0;
    const callback: SearchCallback = async (query, topK) => {
      count++;
      if (count % 2 === 0) {
        throw new Error('偶数查询失败');
      }
      return { resultIds: ['d1'], durationMs: 50 };
    };
    const result = await benchmark.runLatencyBenchmark(queries, callback, 5);
    expect(result.failedQueries).toBeGreaterThan(0);
  });

  it('应生成直方图', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 30 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const callback: SearchCallback = async (query) => {
      const idx = parseInt(query.split(' ')[1] ?? '0', 10);
      return {
        resultIds: ['d1'],
        durationMs: idx * 10, // 0-290ms
      };
    };
    const result = await benchmark.runLatencyBenchmark(queries, callback, 5);
    expect(result.histogram.length).toBeGreaterThan(0);
    expect(result.histogram[0]!.percentage).toBeGreaterThan(0);
  });

  it('空查询应返回零结果', async () => {
    const result = await benchmark.runLatencyBenchmark([], async () => ({
      resultIds: [],
      durationMs: 0,
    }));
    expect(result.totalQueries).toBe(0);
    expect(result.avgLatencyMs).toBe(0);
  });
});

describe('RAGPerformanceBenchmark - 吞吐量基准测试', () => {
  let benchmark: RAGPerformanceBenchmark;

  beforeEach(() => {
    benchmark = new RAGPerformanceBenchmark();
  });

  it('应能运行吞吐量基准测试', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 20 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const callback: SearchCallback = async (query, topK) => ({
      resultIds: ['d1'],
      durationMs: 10,
    });
    const result = await benchmark.runThroughputBenchmark(queries, callback, 5, 5);
    expect(result.totalQueries).toBe(20);
    expect(result.concurrency).toBe(5);
    expect(result.queriesPerSec).toBeGreaterThan(0);
  });

  it('应支持高并发', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 100 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const callback: SearchCallback = async (query, topK) => ({
      resultIds: ['d1'],
      durationMs: 5,
    });
    const result = await benchmark.runThroughputBenchmark(queries, callback, 50, 5);
    expect(result.queriesPerSec).toBeGreaterThan(50);
  });

  it('应计算错误率', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    let count = 0;
    const callback: SearchCallback = async (query, topK) => {
      count++;
      if (count % 4 === 0) throw new Error('fail');
      return { resultIds: ['d1'], durationMs: 5 };
    };
    const result = await benchmark.runThroughputBenchmark(queries, callback, 2, 5);
    expect(result.errorRate).toBeGreaterThan(0);
  });
});

describe('RAGPerformanceBenchmark - 缓存基准测试', () => {
  let benchmark: RAGPerformanceBenchmark;

  beforeEach(() => {
    benchmark = new RAGPerformanceBenchmark();
  });

  it('应能运行缓存基准测试', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const seen = new Set<string>();
    const callback: RAGCallback = async (query) => {
      const isHit = seen.has(query);
      seen.add(query);
      return {
        answer: 'answer',
        citations: [],
        durationMs: isHit ? 1 : 100,
        cacheHit: isHit,
      };
    };
    const result = await benchmark.runCacheBenchmark(queries, callback, 3);
    expect(result.totalQueries).toBe(30);
    expect(result.cacheHitRate).toBeGreaterThan(0);
  });

  it('应正确统计唯一和重复查询', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const callback: RAGCallback = async () => ({
      answer: '',
      citations: [],
      durationMs: 1,
      cacheHit: false,
    });
    const result = await benchmark.runCacheBenchmark(queries, callback, 2);
    expect(result.uniqueQueries).toBe(5);
    expect(result.duplicateQueries).toBe(5);
  });

  it('应计算性能提升倍数', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    let isFirstRound = true;
    const callback: RAGCallback = async (query) => {
      const isHit = !isFirstRound;
      return {
        answer: '',
        citations: [],
        durationMs: isHit ? 1 : 100,
        cacheHit: isHit,
      };
    };
    const result = await benchmark.runCacheBenchmark(queries, callback, 3);
    expect(result.speedupFactor).toBeGreaterThan(1);
    isFirstRound = false; // Note: doesn't matter since we run sequentially
  });
});

describe('RAGPerformanceBenchmark - 回归测试', () => {
  let benchmark: RAGPerformanceBenchmark;

  beforeEach(() => {
    benchmark = new RAGPerformanceBenchmark();
  });

  it('应能检测性能回归', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));

    const baselineResult: LatencyResult = {
      testName: 'baseline',
      timestamp: Date.now() - 1000,
      totalQueries: 10,
      successQueries: 10,
      failedQueries: 0,
      errorRate: 0,
      avgLatencyMs: 50,
      minLatencyMs: 40,
      maxLatencyMs: 60,
      p50LatencyMs: 50,
      p90LatencyMs: 58,
      p95LatencyMs: 59,
      p99LatencyMs: 60,
      stdDevMs: 5,
      histogram: [],
    };

    const callback: SearchCallback = async () => ({
      resultIds: ['d1'],
      durationMs: 100, // 慢了 2 倍
    });
    const result = await benchmark.runRegressionBenchmark(baselineResult, queries, callback, 5, 10);
    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('无回归应通过', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));

    const baselineResult: LatencyResult = {
      testName: 'baseline',
      timestamp: Date.now() - 1000,
      totalQueries: 10,
      successQueries: 10,
      failedQueries: 0,
      errorRate: 0,
      avgLatencyMs: 50,
      minLatencyMs: 40,
      maxLatencyMs: 60,
      p50LatencyMs: 50,
      p90LatencyMs: 58,
      p95LatencyMs: 59,
      p99LatencyMs: 60,
      stdDevMs: 5,
      histogram: [],
    };

    const callback: SearchCallback = async () => ({
      resultIds: ['d1'],
      durationMs: 52, // 在容差范围内
    });
    const result = await benchmark.runRegressionBenchmark(baselineResult, queries, callback, 5, 10);
    expect(result.passed).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('应计算性能变化倍数', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));

    const baselineResult: LatencyResult = {
      testName: 'baseline',
      timestamp: 0,
      totalQueries: 5,
      successQueries: 5,
      failedQueries: 0,
      errorRate: 0,
      avgLatencyMs: 100,
      minLatencyMs: 90,
      maxLatencyMs: 110,
      p50LatencyMs: 100,
      p90LatencyMs: 108,
      p95LatencyMs: 109,
      p99LatencyMs: 110,
      stdDevMs: 5,
      histogram: [],
    };

    const callback: SearchCallback = async () => ({
      resultIds: ['d1'],
      durationMs: 80, // 快 20%
    });
    const result = await benchmark.runRegressionBenchmark(baselineResult, queries, callback, 5, 10);
    expect(result.performanceChange).toBeCloseTo(0.8, 1);
  });
});

describe('RAGPerformanceBenchmark - 综合压测', () => {
  let benchmark: RAGPerformanceBenchmark;

  beforeEach(() => {
    benchmark = new RAGPerformanceBenchmark();
  });

  it('应能运行综合压测', async () => {
    const queries: BenchmarkQuery[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const searchCallback: SearchCallback = async () => ({
      resultIds: ['d1'],
      durationMs: 10,
    });
    const seen = new Set<string>();
    const ragCallback: RAGCallback = async (query) => {
      const isHit = seen.has(query);
      seen.add(query);
      return {
        answer: '',
        citations: [],
        durationMs: isHit ? 1 : 50,
        cacheHit: isHit,
      };
    };
    const result = await benchmark.runFullSuite(queries, searchCallback, ragCallback, {
      concurrency: 2,
      topK: 3,
      cacheRepeat: 2,
    });
    expect(result.latency).toBeDefined();
    expect(result.throughput).toBeDefined();
    expect(result.cache).toBeDefined();
  });

  it('应评估阈值', async () => {
    const benchmark2 = new RAGPerformanceBenchmark({
      thresholds: {
        maxAvgLatencyMs: 5,
      },
    });
    const queries: BenchmarkQuery[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const searchCallback: SearchCallback = async () => ({
      resultIds: ['d1'],
      durationMs: 100, // 超过阈值
    });
    const ragCallback: RAGCallback = async () => ({
      answer: '',
      citations: [],
      durationMs: 0,
      cacheHit: false,
    });
    const result = await benchmark2.runFullSuite(queries, searchCallback, ragCallback, {
      concurrency: 2,
      cacheRepeat: 2,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
  });

  it('应触发进度回调', async () => {
    const onProgress = vi.fn();
    const benchmark2 = new RAGPerformanceBenchmark({ onProgress });
    const queries: BenchmarkQuery[] = Array.from({ length: 10 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const searchCallback: SearchCallback = async () => ({
      resultIds: ['d1'],
      durationMs: 1,
    });
    const ragCallback: RAGCallback = async () => ({
      answer: '',
      citations: [],
      durationMs: 0,
      cacheHit: false,
    });
    await benchmark2.runFullSuite(queries, searchCallback, ragCallback, {
      concurrency: 2,
      cacheRepeat: 2,
    });
    expect(onProgress).toHaveBeenCalled();
    const calls = onProgress.mock.calls;
    const stages = new Set(calls.map((c) => c[0].stage));
    expect(stages.has('latency')).toBe(true);
    expect(stages.has('throughput')).toBe(true);
    expect(stages.has('cache')).toBe(true);
    expect(stages.has('complete')).toBe(true);
  });
});

describe('RAGPerformanceBenchmark - 内存监控', () => {
  let benchmark: RAGPerformanceBenchmark;

  beforeEach(() => {
    benchmark = new RAGPerformanceBenchmark();
  });

  it('应能记录内存快照', () => {
    benchmark.recordMemory('start');
    benchmark.recordMemory('end');
    const snapshots = benchmark.getMemorySnapshots();
    expect(snapshots.length).toBe(2);
    expect(snapshots[0]!.label).toBe('start');
    expect(snapshots[1]!.label).toBe('end');
  });

  it('应能计算内存增长', () => {
    benchmark.recordMemory('start');
    benchmark.recordMemory('end');
    const growth = benchmark.getMemoryGrowth();
    expect(growth).not.toBeNull();
    expect(growth!.label).toContain('→');
  });

  it('不足 2 个快照应返回 null', () => {
    benchmark.recordMemory('only');
    expect(benchmark.getMemoryGrowth()).toBeNull();
  });

  it('应能清空内存快照', () => {
    benchmark.recordMemory('a');
    benchmark.clearMemorySnapshots();
    expect(benchmark.getMemorySnapshots().length).toBe(0);
  });
});

describe('RAGPerformanceBenchmark - 报告导出', () => {
  let benchmark: RAGPerformanceBenchmark;

  beforeEach(() => {
    benchmark = new RAGPerformanceBenchmark();
  });

  it('应能导出 JSON 报告', () => {
    const data = { result: { avgLatencyMs: 50, p95: 100 } };
    const json = benchmark.exportReport(data, 'json');
    expect(JSON.parse(json)).toEqual(data);
  });

  it('应能导出 Markdown 报告', () => {
    const data = {
      name: 'test',
      latency: {
        avgLatencyMs: 50,
        p95: 100,
      },
    };
    const md = benchmark.exportReport(data, 'markdown');
    expect(md).toContain('# RAG 性能基准测试报告');
    expect(md).toContain('**name**');
    expect(md).toContain('**avgLatencyMs**');
  });

  it('Markdown 应正确处理数组', () => {
    const data = {
      items: [
        { name: 'a', value: 10 },
        { name: 'b', value: 20 },
      ],
    };
    const md = benchmark.exportReport(data, 'markdown');
    expect(md).toContain('| name');
    expect(md).toContain('| a |');
    expect(md).toContain('| b |');
  });
});

describe('RAGPerformanceBenchmark - 工厂函数', () => {
  it('createPerformanceBenchmark 应返回带默认阈值的实例', () => {
    const benchmark = createPerformanceBenchmark();
    expect(benchmark).toBeDefined();
  });

  it('应支持自定义名称', () => {
    const benchmark = createPerformanceBenchmark({ name: 'custom-test' });
    expect(benchmark).toBeDefined();
  });

  it('应支持自定义阈值', () => {
    const benchmark = createPerformanceBenchmark({
      thresholds: {
        maxAvgLatencyMs: 10,
        minThroughputQPS: 1000,
      },
    });
    expect(benchmark).toBeDefined();
  });
});

describe('RAGPerformanceBenchmark - 边界情况', () => {
  it('空查询延迟测试', async () => {
    const benchmark = new RAGPerformanceBenchmark();
    const result = await benchmark.runLatencyBenchmark([], async () => ({
      resultIds: [],
      durationMs: 0,
    }));
    expect(result.totalQueries).toBe(0);
  });

  it('空查询吞吐量测试', async () => {
    const benchmark = new RAGPerformanceBenchmark();
    const result = await benchmark.runThroughputBenchmark([], async () => ({
      resultIds: [],
      durationMs: 0,
    }), 1);
    expect(result.totalQueries).toBe(0);
    expect(result.queriesPerSec).toBe(0);
  });

  it('空查询缓存测试', async () => {
    const benchmark = new RAGPerformanceBenchmark();
    const result = await benchmark.runCacheBenchmark([], async () => ({
      answer: '',
      citations: [],
      durationMs: 0,
      cacheHit: false,
    }));
    expect(result.cacheHitRate).toBe(0);
  });

  it('callback 全部失败应被正确统计', async () => {
    const benchmark = new RAGPerformanceBenchmark();
    const queries: BenchmarkQuery[] = Array.from({ length: 5 }, (_, i) => ({
      id: `q-${i}`,
      query: `query ${i}`,
    }));
    const callback: SearchCallback = async () => {
      throw new Error('always fail');
    };
    const result = await benchmark.runLatencyBenchmark(queries, callback, 5);
    expect(result.failedQueries).toBe(5);
    expect(result.successQueries).toBe(0);
    expect(result.avgLatencyMs).toBe(0);
  });

  it('大语料库生成性能', () => {
    const start = Date.now();
    const corpus = RAGPerformanceBenchmark.generateCorpus(1000);
    const duration = Date.now() - start;
    expect(corpus.length).toBe(1000);
    expect(duration).toBeLessThan(5000); // 5 秒内完成
  });
});
