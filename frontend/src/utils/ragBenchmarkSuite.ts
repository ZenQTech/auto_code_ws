/**
 * # ============================================================
 * # RAGPerformanceBenchmark - RAG 性能基准测试套件 (v1.0.0 Cycle 47 G47-04)
 * # ============================================================
 * # 核心作用：RAG 系统自动化性能基准测试,验证生产可用性
 * #           - 10K+ 文档规模基准测试
 * #           - 100+ 并发查询压测
 * #           - P50/P95/P99 延迟统计
 * #           - 吞吐量测试 (queries/sec)
 * #           - 内存占用监控
 * #           - 缓存命中率测试
 * #           - 性能回归检测
 * #           - 测试报告生成 (JSON / Markdown)
 * # 对标产品: k6 / Locust / Apache Bench / Vegeta
 * # 设计要点:
 * #   1. 多维度测试: 延迟 / 吞吐量 / 缓存 / 回归
 * #   2. 真实场景: 模拟真实 RAG 流程 (检索 + 生成)
 * #   3. 完整统计: 平均/中位数/百分位数
 * #   4. 报告友好: JSON + Markdown 双重输出
 * #   5. 性能阈值: 自动评估是否通过基准
 * # ============================================================
 * # 修改记录:
 * #   - 2026-08-01 | v1.0.0 | Cycle 47 G47-04 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

/** 测试文档 */
export interface BenchmarkDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

/** 测试查询 */
export interface BenchmarkQuery {
  id?: string;
  query: string;
  expectedTopK?: string[];     // 期望的 topK 文档 ID
  metadata?: Record<string, unknown>;
}

/** 检索回调函数类型 */
export type SearchCallback = (query: string, topK: number) => Promise<{
  resultIds: string[];
  durationMs: number;
  metadata?: Record<string, unknown>;
}>;

/** 完整 RAG 回调函数类型 */
export type RAGCallback = (query: string) => Promise<{
  answer: string;
  citations: Array<{ id: string; title?: string; snippet: string; score: number }>;
  durationMs: number;
  tokens?: { input: number; output: number; total: number };
  cost?: number;
  cacheHit?: boolean;
}>;

/** 延迟测试结果 */
export interface LatencyResult {
  /** 测试名称 */
  testName: string;
  /** 测试时间 */
  timestamp: number;
  /** 总查询数 */
  totalQueries: number;
  /** 成功查询数 */
  successQueries: number;
  /** 失败查询数 */
  failedQueries: number;
  /** 错误率 (0-1) */
  errorRate: number;
  /** 平均延迟 (ms) */
  avgLatencyMs: number;
  /** 最小延迟 (ms) */
  minLatencyMs: number;
  /** 最大延迟 (ms) */
  maxLatencyMs: number;
  /** 中位数 P50 (ms) */
  p50LatencyMs: number;
  /** P90 延迟 (ms) */
  p90LatencyMs: number;
  /** P95 延迟 (ms) */
  p95LatencyMs: number;
  /** P99 延迟 (ms) */
  p99LatencyMs: number;
  /** 标准差 (ms) */
  stdDevMs: number;
  /** 查询耗时分布直方图 */
  histogram: Array<{ range: string; count: number; percentage: number }>;
}

/** 吞吐量测试结果 */
export interface ThroughputResult {
  /** 测试名称 */
  testName: string;
  /** 测试时间 */
  timestamp: number;
  /** 并发数 */
  concurrency: number;
  /** 总查询数 */
  totalQueries: number;
  /** 成功查询数 */
  successQueries: number;
  /** 失败查询数 */
  failedQueries: number;
  /** 总耗时 (ms) */
  totalDurationMs: number;
  /** 吞吐量 (queries/sec) */
  queriesPerSec: number;
  /** 平均延迟 (ms) */
  avgLatencyMs: number;
  /** P95 延迟 (ms) */
  p95LatencyMs: number;
  /** 错误率 (0-1) */
  errorRate: number;
}

/** 缓存基准测试结果 */
export interface CacheBenchmarkResult {
  /** 测试名称 */
  testName: string;
  /** 测试时间 */
  timestamp: number;
  /** 总查询数 */
  totalQueries: number;
  /** 唯一查询数 */
  uniqueQueries: number;
  /** 重复查询数 */
  duplicateQueries: number;
  /** 缓存命中数 */
  cacheHits: number;
  /** 缓存未命中数 */
  cacheMisses: number;
  /** 缓存命中率 (0-1) */
  cacheHitRate: number;
  /** 平均命中查询延迟 (ms) */
  avgHitLatencyMs: number;
  /** 平均未命中查询延迟 (ms) */
  avgMissLatencyMs: number;
  /** 性能提升倍数 */
  speedupFactor: number;
}

/** 回归测试结果 */
export interface RegressionResult {
  /** 测试名称 */
  testName: string;
  /** 测试时间 */
  timestamp: number;
  /** 基线数据 */
  baseline: LatencyResult;
  /** 当前数据 */
  current: LatencyResult;
  /** 是否通过 (无回归) */
  passed: boolean;
  /** 性能变化 (倍数, <1 表示性能下降) */
  performanceChange: number;
  /** P95 变化 (倍数) */
  p95Change: number;
  /** 错误 */
  errors: string[];
}

/** 内存监控结果 */
export interface MemorySnapshot {
  timestamp: number;
  usedBytes: number;
  totalBytes: number;
  limitBytes: number;
  label?: string;
}

/** 基准配置 */
export interface BenchmarkConfig {
  /** 测试名称 */
  name?: string;
  /** 进度回调 */
  onProgress?: (progress: { stage: string; current: number; total: number; percent: number }) => void;
  /** 性能阈值 */
  thresholds?: {
    maxAvgLatencyMs?: number;
    maxP95LatencyMs?: number;
    minThroughputQPS?: number;
    minCacheHitRate?: number;
  };
}

/** 报告格式 */
export type ReportFormat = 'json' | 'markdown';

// ============ 工具函数 ============

/**
 * 计算百分位数
 */
function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const idx = (sortedValues.length - 1) * p;
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) {
    return sortedValues[lower];
  }
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (idx - lower);
}

/**
 * 计算平均值
 */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/**
 * 计算标准差
 */
function stdDev(values: number[], avg?: number): number {
  if (values.length === 0) return 0;
  const a = avg ?? mean(values);
  const squareDiffs = values.map((v) => (v - a) ** 2);
  return Math.sqrt(mean(squareDiffs));
}

/**
 * 生成查询直方图
 */
function buildHistogram(values: number[], bins: number = 10): Array<{ range: string; count: number; percentage: number }> {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    return [{ range: `${min.toFixed(1)}ms`, count: values.length, percentage: 100 }];
  }

  const binWidth = (max - min) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
    counts[idx]++;
  }

  return counts.map((count, i) => {
    const start = min + i * binWidth;
    const end = start + binWidth;
    return {
      range: `${start.toFixed(1)}-${end.toFixed(1)}ms`,
      count,
      percentage: (count / values.length) * 100,
    };
  });
}

/**
 * 获取内存快照 (浏览器环境)
 */
function getMemorySnapshot(label?: string): MemorySnapshot {
  const now = Date.now();
  // 使用 performance.memory (Chrome only)
  const perf = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } });
  if (perf.memory) {
    return {
      timestamp: now,
      usedBytes: perf.memory.usedJSHeapSize,
      totalBytes: perf.memory.totalJSHeapSize,
      limitBytes: perf.memory.jsHeapSizeLimit,
      label,
    };
  }
  // 降级方案: 使用 0 占位
  return {
    timestamp: now,
    usedBytes: 0,
    totalBytes: 0,
    limitBytes: 0,
    label,
  };
}

/**
 * 并发执行
 */
async function runConcurrent<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < tasks.length) {
      const currentIdx = index++;
      try {
        const result = await tasks[currentIdx]!();
        results[currentIdx] = result;
      } catch (e) {
        // 错误占位
        results[currentIdx] = null as T;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * 睡眠
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ RAGPerformanceBenchmark 主类 ============

/**
 * RAG 性能基准测试套件
 */
export class RAGPerformanceBenchmark {
  private readonly name: string;
  private readonly onProgress?: (progress: { stage: string; current: number; total: number; percent: number }) => void;
  private readonly thresholds: BenchmarkConfig['thresholds'];
  private memorySnapshots: MemorySnapshot[] = [];

  constructor(config: BenchmarkConfig = {}) {
    this.name = config.name ?? 'rag-benchmark';
    this.onProgress = config.onProgress;
    this.thresholds = config.thresholds;
  }

  // ============ 文档语料库管理 ============

  /**
   * 生成模拟文档语料库
   */
  static generateCorpus(size: number, options: { avgDocLength?: number; seed?: number } = {}): BenchmarkDocument[] {
    const docs: BenchmarkDocument[] = [];
    const avgDocLength = options.avgDocLength ?? 500;
    const seed = options.seed ?? 42;

    let rng = seed;
    const random = (): number => {
      rng = (rng * 9301 + 49297) % 233280;
      return rng / 233280;
    };

    const topics = [
      '人工智能', '机器学习', '深度学习', '自然语言处理', '计算机视觉',
      '机器人', '自动驾驶', '数据分析', '云计算', '边缘计算',
      '向量数据库', '知识图谱', 'Transformer', 'BERT', 'GPT',
      'RAG', '智能体', '多模态', '联邦学习', '强化学习',
    ];

    for (let i = 0; i < size; i++) {
      const topic = topics[Math.floor(random() * topics.length)]!;
      const subTopic = topics[Math.floor(random() * topics.length)]!;
      const length = Math.floor(avgDocLength * (0.5 + random()));
      let content = `本文档讨论 ${topic} 与 ${subTopic} 的关系。`;
      while (content.length < length) {
        content += ` ${topic} 技术在 ${subTopic} 领域有广泛应用。`;
      }
      docs.push({
        id: `doc-${i.toString().padStart(6, '0')}`,
        content: content.slice(0, length),
        metadata: {
          topic,
          subTopic,
          index: i,
        },
      });
    }
    return docs;
  }

  /**
   * 生成模拟查询
   */
  static generateQueries(count: number, corpus: BenchmarkDocument[], options: { seed?: number } = {}): BenchmarkQuery[] {
    const queries: BenchmarkQuery[] = [];
    const seed = options.seed ?? 123;

    let rng = seed;
    const random = (): number => {
      rng = (rng * 9301 + 49297) % 233280;
      return rng / 233280;
    };

    const templates = [
      '什么是 {topic}?',
      '{topic} 和 {subTopic} 的区别',
      '如何使用 {topic} 解决 {subTopic} 问题',
      '{topic} 的应用场景',
      '解释 {topic} 的原理',
      '{topic} 的最新进展',
      '{subTopic} 中 {topic} 的角色',
      '{topic} 与 {subTopic} 的关系',
    ];

    for (let i = 0; i < count; i++) {
      const doc = corpus[Math.floor(random() * corpus.length)]!;
      const topic = (doc.metadata?.topic as string) ?? '人工智能';
      const subTopic = (doc.metadata?.subTopic as string) ?? '机器学习';
      const template = templates[Math.floor(random() * templates.length)]!;
      const queryText = template.replace('{topic}', topic).replace('{subTopic}', subTopic);
      queries.push({
        id: `q-${i.toString().padStart(6, '0')}`,
        query: queryText,
        expectedTopK: [doc.id],
        metadata: { expectedDocId: doc.id },
      });
    }
    return queries;
  }

  // ============ 延迟基准测试 ============

  /**
   * 运行延迟基准测试
   */
  async runLatencyBenchmark(
    queries: BenchmarkQuery[],
    callback: SearchCallback,
    topK: number = 5
  ): Promise<LatencyResult> {
    const latencies: number[] = [];
    let successCount = 0;
    let failedCount = 0;

    this.recordMemory(`latency-start-${this.name}`);

    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]!;
      try {
        const result = await callback(q.query, topK);
        latencies.push(result.durationMs);
        successCount++;
      } catch (e) {
        failedCount++;
      }

      if (this.onProgress && i % Math.max(1, Math.floor(queries.length / 20)) === 0) {
        this.onProgress({
          stage: 'latency',
          current: i + 1,
          total: queries.length,
          percent: ((i + 1) / queries.length) * 100,
        });
      }
    }

    this.recordMemory(`latency-end-${this.name}`);

    return this.buildLatencyResult(
      `latency-benchmark-${this.name}`,
      latencies,
      successCount,
      failedCount
    );
  }

  // ============ 吞吐量基准测试 ============

  /**
   * 运行吞吐量基准测试
   */
  async runThroughputBenchmark(
    queries: BenchmarkQuery[],
    callback: SearchCallback,
    concurrency: number = 10,
    topK: number = 5
  ): Promise<ThroughputResult> {
    const startTime = Date.now();
    const latencies: number[] = [];
    let successCount = 0;
    let failedCount = 0;

    this.recordMemory(`throughput-start-${this.name}-c${concurrency}`);

    const tasks = queries.map((q) => async () => {
      try {
        const result = await callback(q.query, topK);
        latencies.push(result.durationMs);
        return { ok: true, latency: result.durationMs };
      } catch (e) {
        return { ok: false, latency: 0 };
      }
    });

    const results = await runConcurrent(tasks, concurrency);
    const totalDuration = Date.now() - startTime;

    successCount = results.filter((r) => r && r.ok).length;
    failedCount = results.filter((r) => r && !r.ok).length;

    this.recordMemory(`throughput-end-${this.name}-c${concurrency}`);

    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    return {
      testName: `throughput-benchmark-${this.name}-c${concurrency}`,
      timestamp: Date.now(),
      concurrency,
      totalQueries: queries.length,
      successQueries: successCount,
      failedQueries: failedCount,
      totalDurationMs: totalDuration,
      // 使用 max(totalDuration, 1) 避免除零,同时保证快速测试也能产生合理的 QPS
      queriesPerSec: successCount > 0 ? (successCount / Math.max(totalDuration, 1)) * 1000 : 0,
      avgLatencyMs: mean(latencies),
      p95LatencyMs: percentile(sortedLatencies, 0.95),
      errorRate: queries.length > 0 ? failedCount / queries.length : 0,
    };
  }

  // ============ 缓存基准测试 ============

  /**
   * 运行缓存基准测试
   */
  async runCacheBenchmark(
    queries: BenchmarkQuery[],
    callback: RAGCallback,
    repeatFactor: number = 3
  ): Promise<CacheBenchmarkResult> {
    const uniqueCount = queries.length;
    const totalQueries = queries.length * repeatFactor;
    let cacheHits = 0;
    let cacheMisses = 0;
    const hitLatencies: number[] = [];
    const missLatencies: number[] = [];

    this.recordMemory(`cache-start-${this.name}`);

    // 第一轮: 全部 miss
    for (let i = 0; i < queries.length; i++) {
      const q = queries[i]!;
      try {
        const result = await callback(q.query);
        if (result.cacheHit) {
          cacheHits++;
          hitLatencies.push(result.durationMs);
        } else {
          cacheMisses++;
          missLatencies.push(result.durationMs);
        }
      } catch (e) {
        cacheMisses++;
        missLatencies.push(0);
      }
      if (this.onProgress && i % Math.max(1, Math.floor(queries.length / 20)) === 0) {
        this.onProgress({
          stage: 'cache-miss',
          current: i + 1,
          total: queries.length * repeatFactor,
          percent: ((i + 1) / (queries.length * repeatFactor)) * 50,
        });
      }
    }

    // 后续轮次: 应该全部 hit
    for (let round = 1; round < repeatFactor; round++) {
      for (let i = 0; i < queries.length; i++) {
        const q = queries[i]!;
        try {
          const result = await callback(q.query);
          if (result.cacheHit) {
            cacheHits++;
            hitLatencies.push(result.durationMs);
          } else {
            cacheMisses++;
            missLatencies.push(result.durationMs);
          }
        } catch (e) {
          cacheMisses++;
          missLatencies.push(0);
        }
        const overallIdx = queries.length * round + i;
        if (this.onProgress && overallIdx % Math.max(1, Math.floor(totalQueries / 20)) === 0) {
          this.onProgress({
            stage: 'cache-hit',
            current: overallIdx + 1,
            total: totalQueries,
            percent: ((overallIdx + 1) / totalQueries) * 100,
          });
        }
      }
    }

    this.recordMemory(`cache-end-${this.name}`);

    const avgHit = mean(hitLatencies);
    const avgMiss = mean(missLatencies);
    const speedup = avgMiss > 0 ? avgMiss / Math.max(avgHit, 0.001) : 0;

    return {
      testName: `cache-benchmark-${this.name}`,
      timestamp: Date.now(),
      totalQueries,
      uniqueQueries: uniqueCount,
      duplicateQueries: totalQueries - uniqueCount,
      cacheHits,
      cacheMisses,
      cacheHitRate: totalQueries > 0 ? cacheHits / totalQueries : 0,
      avgHitLatencyMs: avgHit,
      avgMissLatencyMs: avgMiss,
      speedupFactor: speedup,
    };
  }

  // ============ 回归测试 ============

  /**
   * 运行性能回归测试 (对比基线)
   */
  async runRegressionBenchmark(
    baseline: LatencyResult,
    queries: BenchmarkQuery[],
    callback: SearchCallback,
    topK: number = 5,
    tolerancePercent: number = 10
  ): Promise<RegressionResult> {
    const current = await this.runLatencyBenchmark(queries, callback, topK);
    const errors: string[] = [];

    // 性能变化倍数 (current/baseline, <1 表示性能下降)
    const performanceChange = current.avgLatencyMs / Math.max(baseline.avgLatencyMs, 0.001);
    const p95Change = current.p95LatencyMs / Math.max(baseline.p95LatencyMs, 0.001);

    const toleranceFactor = 1 + tolerancePercent / 100;

    if (current.avgLatencyMs > baseline.avgLatencyMs * toleranceFactor) {
      errors.push(
        `平均延迟回归: ${baseline.avgLatencyMs.toFixed(2)}ms → ${current.avgLatencyMs.toFixed(2)}ms (${(performanceChange * 100).toFixed(1)}%)`
      );
    }
    if (current.p95LatencyMs > baseline.p95LatencyMs * toleranceFactor) {
      errors.push(
        `P95 延迟回归: ${baseline.p95LatencyMs.toFixed(2)}ms → ${current.p95LatencyMs.toFixed(2)}ms (${(p95Change * 100).toFixed(1)}%)`
      );
    }
    if (current.errorRate > baseline.errorRate + 0.01) {
      errors.push(
        `错误率上升: ${(baseline.errorRate * 100).toFixed(2)}% → ${(current.errorRate * 100).toFixed(2)}%`
      );
    }

    return {
      testName: `regression-benchmark-${this.name}`,
      timestamp: Date.now(),
      baseline,
      current,
      passed: errors.length === 0,
      performanceChange,
      p95Change,
      errors,
    };
  }

  // ============ 综合压测 ============

  /**
   * 综合压测: 一次性运行延迟 + 吞吐量 + 缓存
   */
  async runFullSuite(
    queries: BenchmarkQuery[],
    searchCallback: SearchCallback,
    ragCallback: RAGCallback,
    options: { concurrency?: number; topK?: number; cacheRepeat?: number } = {}
  ): Promise<{
    latency: LatencyResult;
    throughput: ThroughputResult;
    cache: CacheBenchmarkResult;
    passed: boolean;
    failures: string[];
  }> {
    const concurrency = options.concurrency ?? 10;
    const topK = options.topK ?? 5;
    const cacheRepeat = options.cacheRepeat ?? 3;

    // 1. 延迟测试
    this.onProgress?.({ stage: 'latency', current: 0, total: queries.length, percent: 0 });
    const latency = await this.runLatencyBenchmark(queries, searchCallback, topK);

    // 短暂冷却
    await sleep(100);

    // 2. 吞吐量测试
    this.onProgress?.({ stage: 'throughput', current: 0, total: queries.length, percent: 0 });
    const throughput = await this.runThroughputBenchmark(queries, searchCallback, concurrency, topK);

    // 短暂冷却
    await sleep(100);

    // 3. 缓存测试
    this.onProgress?.({ stage: 'cache', current: 0, total: queries.length * cacheRepeat, percent: 0 });
    const cache = await this.runCacheBenchmark(queries, ragCallback, cacheRepeat);

    // 4. 评估阈值
    const failures: string[] = [];
    if (this.thresholds?.maxAvgLatencyMs && latency.avgLatencyMs > this.thresholds.maxAvgLatencyMs) {
      failures.push(`平均延迟 ${latency.avgLatencyMs.toFixed(2)}ms 超过阈值 ${this.thresholds.maxAvgLatencyMs}ms`);
    }
    if (this.thresholds?.maxP95LatencyMs && latency.p95LatencyMs > this.thresholds.maxP95LatencyMs) {
      failures.push(`P95 延迟 ${latency.p95LatencyMs.toFixed(2)}ms 超过阈值 ${this.thresholds.maxP95LatencyMs}ms`);
    }
    if (this.thresholds?.minThroughputQPS && throughput.queriesPerSec < this.thresholds.minThroughputQPS) {
      failures.push(`吞吐量 ${throughput.queriesPerSec.toFixed(2)} qps 低于阈值 ${this.thresholds.minThroughputQPS} qps`);
    }
    if (this.thresholds?.minCacheHitRate && cache.cacheHitRate < this.thresholds.minCacheHitRate) {
      failures.push(`缓存命中率 ${(cache.cacheHitRate * 100).toFixed(2)}% 低于阈值 ${(this.thresholds.minCacheHitRate * 100).toFixed(2)}%`);
    }

    this.onProgress?.({ stage: 'complete', current: 1, total: 1, percent: 100 });

    return {
      latency,
      throughput,
      cache,
      passed: failures.length === 0,
      failures,
    };
  }

  // ============ 内存监控 ============

  /**
   * 记录内存快照
   */
  recordMemory(label?: string): MemorySnapshot {
    const snapshot = getMemorySnapshot(label ?? `snapshot-${this.memorySnapshots.length}`);
    this.memorySnapshots.push(snapshot);
    return snapshot;
  }

  /**
   * 获取内存快照列表
   */
  getMemorySnapshots(): MemorySnapshot[] {
    return [...this.memorySnapshots];
  }

  /**
   * 内存使用增量 (最后一次 - 第一次)
   */
  getMemoryGrowth(): { bytes: number; label: string; growthPercent: number } | null {
    if (this.memorySnapshots.length < 2) return null;
    const first = this.memorySnapshots[0]!;
    const last = this.memorySnapshots[this.memorySnapshots.length - 1]!;
    const bytes = last.usedBytes - first.usedBytes;
    return {
      bytes,
      label: `${first.label ?? 'start'} → ${last.label ?? 'end'}`,
      growthPercent: first.usedBytes > 0 ? (bytes / first.usedBytes) * 100 : 0,
    };
  }

  /**
   * 清空内存快照
   */
  clearMemorySnapshots(): void {
    this.memorySnapshots = [];
  }

  // ============ 报告导出 ============

  /**
   * 导出测试报告
   */
  exportReport(data: unknown, format: ReportFormat): string {
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    } else {
      return this.toMarkdown(data);
    }
  }

  private toMarkdown(data: unknown): string {
    const lines: string[] = [];
    lines.push(`# RAG 性能基准测试报告 - ${this.name}`);
    lines.push(`\n生成时间: ${new Date().toISOString()}\n`);

    if (data && typeof data === 'object') {
      this.objectToMarkdown(data, lines, 0);
    }
    return lines.join('\n');
  }

  private objectToMarkdown(obj: unknown, lines: string[], indent: number): void {
    if (obj === null || obj === undefined) {
      lines.push(`${'  '.repeat(indent)}null`);
      return;
    }
    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        lines.push(`${'  '.repeat(indent)}[]`);
        return;
      }
      // 检查是否为 LatencyResult / ThroughputResult 等结果对象数组
      if (typeof obj[0] === 'object' && obj[0] !== null) {
        // 输出表头
        const keys = Object.keys(obj[0]);
        lines.push(`${'  '.repeat(indent)}| ${keys.join(' | ')} |`);
        lines.push(`${'  '.repeat(indent)}| ${keys.map(() => '---').join(' | ')} |`);
        for (const item of obj) {
          const values = keys.map((k) => {
            const v = (item as Record<string, unknown>)[k];
            return typeof v === 'number' ? v.toFixed(2) : String(v ?? '');
          });
          lines.push(`${'  '.repeat(indent)}| ${values.join(' | ')} |`);
        }
      } else {
        for (const item of obj) {
          lines.push(`${'  '.repeat(indent)}- ${item}`);
        }
      }
      return;
    }
    if (typeof obj === 'object') {
      for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
          lines.push(`${'  '.repeat(indent)}**${key}**: null`);
        } else if (typeof value === 'object') {
          lines.push(`${'  '.repeat(indent)}**${key}**:`);
          this.objectToMarkdown(value, lines, indent + 1);
        } else if (typeof value === 'number') {
          lines.push(`${'  '.repeat(indent)}**${key}**: ${value.toFixed(2)}`);
        } else {
          lines.push(`${'  '.repeat(indent)}**${key}**: ${value}`);
        }
      }
      return;
    }
    lines.push(`${'  '.repeat(indent)}${obj}`);
  }

  // ============ 内部方法 ============

  private buildLatencyResult(
    testName: string,
    latencies: number[],
    successCount: number,
    failedCount: number
  ): LatencyResult {
    const sorted = [...latencies].sort((a, b) => a - b);
    const avg = mean(latencies);
    const totalQueries = successCount + failedCount;
    return {
      testName,
      timestamp: Date.now(),
      totalQueries,
      successQueries: successCount,
      failedQueries: failedCount,
      errorRate: totalQueries > 0 ? failedCount / totalQueries : 0,
      avgLatencyMs: avg,
      minLatencyMs: sorted.length > 0 ? sorted[0]! : 0,
      maxLatencyMs: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
      p50LatencyMs: percentile(sorted, 0.5),
      p90LatencyMs: percentile(sorted, 0.9),
      p95LatencyMs: percentile(sorted, 0.95),
      p99LatencyMs: percentile(sorted, 0.99),
      stdDevMs: stdDev(latencies, avg),
      histogram: buildHistogram(latencies, 10),
    };
  }
}

// ============ 工厂函数 ============

/**
 * 创建性能基准测试 (含默认阈值)
 */
export function createPerformanceBenchmark(config: Partial<BenchmarkConfig> = {}): RAGPerformanceBenchmark {
  return new RAGPerformanceBenchmark({
    name: config.name ?? 'rag-benchmark',
    onProgress: config.onProgress,
    thresholds: config.thresholds ?? {
      maxAvgLatencyMs: 200,
      maxP95LatencyMs: 500,
      minThroughputQPS: 50,
      minCacheHitRate: 0.3,
    },
  });
}
