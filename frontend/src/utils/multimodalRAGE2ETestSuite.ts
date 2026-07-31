/**
 * # ============================================================
 * # 多模态 RAG 端到端 E2E 测试套件 (Cycle 50 G50-02)
 * # ============================================================
 * # 核心作用：覆盖真实场景的端到端测试
 * #           集成 Embedding → Index → Cache → Search → Answer
 * # 运行流程：
 * #   1. 加载真实文档集 (PDF/图片/混合)
 * #   2. 嵌入到向量索引
 * #   3. 模拟用户查询 (跨模态: 文本→图, 图→文, 图+文→答案)
 * #   4. 验证检索质量 (Recall@K) 和性能 (P95 < 100ms)
 * # 输入参数：无
 * # 输出结果：E2ETestSuiteReport { totalScenarios, passed, failed, p95Latency, recallAt10 }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 50 G50-02 初次创建
 * # ====================================
 */

import { MultimodalEmbedding, type EmbeddingProvider, type MultimodalInput } from './multimodalEmbedding';
import { MultimodalVectorIndex, type CrossModalSearchResult } from './multimodalVectorIndex';
import { MultimodalSemanticCache, type MultimodalCacheStats } from './multimodalSemanticCache';
import { CLIPLocalProvider } from './clipLocalProvider';

// ============================================================
// 类型定义
// ============================================================

/** E2E 场景 */
export interface E2EScenario {
  /** 场景 ID */
  id: string;
  /** 场景名 */
  name: string;
  /** 场景描述 */
  description: string;
  /** 文档集 */
  documents: E2EDocument[];
  /** 查询集 */
  queries: E2EQuery[];
  /** 期望指标 */
  expectations: {
    minRecallAtK?: number;
    maxP95LatencyMs?: number;
    minCacheHitRate?: number;
  };
}

/** E2E 文档 */
export interface E2EDocument {
  id: string;
  modality: 'text' | 'image' | 'multimodal';
  text?: string;
  image?: string;
  /** 期望关联的 query id 列表 (用于计算 Recall) */
  relevantFor?: string[];
  /** 文档类别 (用于分组分析) */
  category?: string;
}

/** E2E 查询 */
export interface E2EQuery {
  id: string;
  modality: 'text' | 'image' | 'multimodal';
  text?: string;
  image?: string;
  /** 期望命中的文档 id 列表 */
  expectedDocIds: string[];
  /** 类别 */
  category?: string;
}

/** 场景执行结果 */
export interface E2EScenarioResult {
  scenarioId: string;
  scenarioName: string;
  passed: boolean;
  durationMs: number;
  metrics: {
    /** Recall@K (默认 K=5) */
    recallAtK: number;
    /** 精确率 */
    precisionAtK: number;
    /** P50 延迟 */
    p50LatencyMs: number;
    /** P95 延迟 */
    p95LatencyMs: number;
    /** 平均延迟 */
    avgLatencyMs: number;
    /** 缓存命中率 */
    cacheHitRate: number;
    /** 总查询数 */
    totalQueries: number;
  };
  failures: string[];
}

/** 整体报告 */
export interface E2ETestSuiteReport {
  /** 套件名 */
  suiteName: string;
  /** 报告生成时间 */
  timestamp: number;
  /** 场景结果 */
  scenarios: E2EScenarioResult[];
  /** 汇总 */
  summary: {
    totalScenarios: number;
    passedScenarios: number;
    failedScenarios: number;
    passRate: number;
    totalQueries: number;
    totalDocuments: number;
    avgRecallAtK: number;
    avgP95LatencyMs: number;
    avgCacheHitRate: number;
  };
}

/** 事件 */
export interface E2EEvent {
  type: 'scenario-start' | 'scenario-complete' | 'query' | 'error' | 'suite-complete';
  timestamp: number;
  scenarioId?: string;
  latencyMs?: number;
  error?: string;
}

export type E2EListener = (event: E2EEvent) => void;

// ============================================================
// 内置场景 (生产场景)
// ============================================================

/**
 * 场景 1: 电商商品检索 (图→文)
 *  - 用户上传商品图片, 系统返回相关文字描述
 */
function createEcommerceScenario(): E2EScenario {
  const documents: E2EDocument[] = [
    { id: 'prod-1', modality: 'multimodal', text: '红色运动鞋 Nike Air Max 90', image: 'https://example.com/red-shoe.jpg', relevantFor: ['q1'], category: 'sports' },
    { id: 'prod-2', modality: 'multimodal', text: '黑色商务皮鞋 牛皮', image: 'https://example.com/black-shoe.jpg', relevantFor: ['q2'], category: 'business' },
    { id: 'prod-3', modality: 'multimodal', text: '白色帆布鞋 Converse', image: 'https://example.com/white-shoe.jpg', relevantFor: ['q3'], category: 'casual' },
    { id: 'prod-4', modality: 'multimodal', text: '蓝色跑鞋 Adidas Ultraboost', image: 'https://example.com/blue-shoe.jpg', relevantFor: ['q4'], category: 'sports' },
    { id: 'prod-5', modality: 'text', text: '运动鞋 跑步鞋 健身鞋', relevantFor: ['q1', 'q4'], category: 'sports' },
    { id: 'prod-6', modality: 'text', text: '皮鞋 商务正装 婚礼', relevantFor: ['q2'], category: 'business' },
    { id: 'prod-7', modality: 'text', text: '帆布鞋 休闲 百搭', relevantFor: ['q3'], category: 'casual' },
  ];
  const queries: E2EQuery[] = [
    { id: 'q1', modality: 'text', text: '红色运动鞋', expectedDocIds: ['prod-1', 'prod-5'], category: 'sports' },
    { id: 'q2', modality: 'text', text: '黑色商务皮鞋', expectedDocIds: ['prod-2', 'prod-6'], category: 'business' },
    { id: 'q3', modality: 'text', text: '白色帆布鞋', expectedDocIds: ['prod-3', 'prod-7'], category: 'casual' },
    { id: 'q4', modality: 'text', text: '蓝色跑步鞋', expectedDocIds: ['prod-4', 'prod-5'], category: 'sports' },
  ];
  return {
    id: 'ecommerce-product-search',
    name: '电商商品检索 (图→文)',
    description: '用户上传商品图片, 系统返回相关文字描述',
    documents,
    queries,
    expectations: { minRecallAtK: 0.5, maxP95LatencyMs: 200, minCacheHitRate: 0 },
  };
}

/**
 * 场景 2: 知识库问答 (文→文)
 *  - 用户提问, 系统检索相关文档
 */
function createKnowledgeBaseScenario(): E2EScenario {
  const documents: E2EDocument[] = [
    { id: 'kb-1', modality: 'text', text: 'FastAPI 是一个用于构建 API 的现代 Python web 框架, 基于标准 Python 类型提示', relevantFor: ['q1', 'q2'] },
    { id: 'kb-2', modality: 'text', text: 'FastAPI 支持异步编程, 内置 OpenAPI 和 JSON Schema 文档', relevantFor: ['q1', 'q2'] },
    { id: 'kb-3', modality: 'text', text: 'React 是 Facebook 开发的前端 JavaScript 库, 用于构建用户界面', relevantFor: ['q3'] },
    { id: 'kb-4', modality: 'text', text: 'Vue 是一款渐进式 JavaScript 框架, 易于上手且功能强大', relevantFor: ['q4'] },
    { id: 'kb-5', modality: 'text', text: 'Docker 容器化技术可以打包应用及其依赖, 实现跨平台部署', relevantFor: ['q5'] },
    { id: 'kb-6', modality: 'text', text: 'Kubernetes 是容器编排系统, 用于自动化部署扩展和管理容器化应用', relevantFor: ['q5', 'q6'] },
  ];
  const queries: E2EQuery[] = [
    { id: 'q1', modality: 'text', text: 'FastAPI 是什么', expectedDocIds: ['kb-1', 'kb-2'] },
    { id: 'q2', modality: 'text', text: 'FastAPI 的特点', expectedDocIds: ['kb-1', 'kb-2'] },
    { id: 'q3', modality: 'text', text: 'React 是哪个公司的', expectedDocIds: ['kb-3'] },
    { id: 'q4', modality: 'text', text: 'Vue 框架', expectedDocIds: ['kb-4'] },
    { id: 'q5', modality: 'text', text: '容器化部署', expectedDocIds: ['kb-5', 'kb-6'] },
    { id: 'q6', modality: 'text', text: 'Kubernetes 作用', expectedDocIds: ['kb-6'] },
  ];
  return {
    id: 'knowledge-base-qa',
    name: '知识库问答 (文→文)',
    description: '用户提问, 系统检索相关文档',
    documents,
    queries,
    expectations: { minRecallAtK: 0.5, maxP95LatencyMs: 200, minCacheHitRate: 0.3 },
  };
}

/**
 * 场景 3: 混合检索 (文+图)
 *  - 用户输入文本 + 图片, 系统返回混合结果
 */
function createHybridSearchScenario(): E2EScenario {
  const documents: E2EDocument[] = [
    { id: 'hyb-1', modality: 'multimodal', text: '上海外滩夜景', image: 'https://example.com/shanghai.jpg', relevantFor: ['q1'] },
    { id: 'hyb-2', modality: 'multimodal', text: '北京故宫', image: 'https://example.com/beijing.jpg', relevantFor: ['q2'] },
    { id: 'hyb-3', modality: 'multimodal', text: '深圳平安大厦', image: 'https://example.com/shenzhen.jpg', relevantFor: ['q3'] },
    { id: 'hyb-4', modality: 'text', text: '上海是中国的经济中心, 有外滩东方明珠等地标', relevantFor: ['q1'] },
    { id: 'hyb-5', modality: 'text', text: '北京是中国的首都, 有故宫长城天安门', relevantFor: ['q2'] },
  ];
  const queries: E2EQuery[] = [
    { id: 'q1', modality: 'multimodal', text: '上海', image: 'https://example.com/user-shanghai.jpg', expectedDocIds: ['hyb-1', 'hyb-4'] },
    { id: 'q2', modality: 'text', text: '北京故宫', expectedDocIds: ['hyb-2', 'hyb-5'] },
    { id: 'q3', modality: 'image', image: 'https://example.com/user-shenzhen.jpg', expectedDocIds: ['hyb-3'] },
  ];
  return {
    id: 'hybrid-search',
    name: '混合检索 (文+图)',
    description: '用户输入文本+图片, 系统返回混合结果',
    documents,
    queries,
    expectations: { minRecallAtK: 0.3, maxP95LatencyMs: 300, minCacheHitRate: 0 },
  };
}

/**
 * 场景 4: 缓存压力测试
 *  - 大量重复查询, 验证缓存效果
 */
function createCacheStressScenario(): E2EScenario {
  const documents: E2EDocument[] = [
    { id: 'cache-1', modality: 'text', text: '产品 A 的功能介绍' },
    { id: 'cache-2', modality: 'text', text: '产品 B 的功能介绍' },
    { id: 'cache-3', modality: 'text', text: '产品 C 的功能介绍' },
  ];
  // 大量重复查询
  const queries: E2EQuery[] = [];
  for (let i = 0; i < 20; i++) {
    queries.push({
      id: `cache-q-${i}`,
      modality: 'text',
      text: i % 3 === 0 ? '产品 A' : i % 3 === 1 ? '产品 B' : '产品 C',
      expectedDocIds: [i % 3 === 0 ? 'cache-1' : i % 3 === 1 ? 'cache-2' : 'cache-3'],
    });
  }
  return {
    id: 'cache-stress',
    name: '缓存压力测试',
    description: '大量重复查询, 验证缓存命中率',
    documents,
    queries,
    expectations: { minRecallAtK: 0.5, maxP95LatencyMs: 100, minCacheHitRate: 0.5 },
  };
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 计算 P95 / P50 延迟
 */
function computePercentile(latencies: number[], percentile: number): number {
  if (latencies.length === 0) return 0;
  const sorted = [...latencies].sort((a, b) => a - b);
  const idx = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

// ============================================================
// MultimodalRAGE2ETestSuite 主类
// ============================================================

export class MultimodalRAGE2ETestSuite {
  private readonly scenarios: E2EScenario[];
  private readonly listeners: Set<E2EListener> = new Set();
  private readonly embedding: MultimodalEmbedding;
  private readonly index: MultimodalVectorIndex;
  private readonly cache: MultimodalSemanticCache<string>;
  private readonly k: number;

  constructor(options: {
    scenarios?: E2EScenario[];
    embedding?: MultimodalEmbedding;
    index?: MultimodalVectorIndex;
    cache?: MultimodalSemanticCache<string>;
    k?: number;
  } = {}) {
    this.scenarios = options.scenarios ?? [
      createEcommerceScenario(),
      createKnowledgeBaseScenario(),
      createHybridSearchScenario(),
      createCacheStressScenario(),
    ];
    this.k = options.k ?? 5;
    this.embedding = options.embedding ?? new MultimodalEmbedding({ dimension: 256 });
    this.index = options.index ?? new MultimodalVectorIndex({ dimension: 256 });
    this.cache = options.cache ?? new MultimodalSemanticCache<string>({ dimension: 256, crossModalityThresholdMultiplier: 0.85 });
  }

  /**
   * 订阅事件
   */
  subscribe(listener: E2EListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 运行所有场景
   */
  async runAll(): Promise<E2ETestSuiteReport> {
    const scenarioResults: E2EScenarioResult[] = [];
    const suiteStart = Date.now();
    for (const scenario of this.scenarios) {
      const result = await this.runScenario(scenario);
      scenarioResults.push(result);
    }
    const totalQueries = scenarioResults.reduce((s, r) => s + r.metrics.totalQueries, 0);
    const totalDocuments = this.scenarios.reduce((s, sc) => s + sc.documents.length, 0);
    const avgRecall = scenarioResults.length > 0
      ? scenarioResults.reduce((s, r) => s + r.metrics.recallAtK, 0) / scenarioResults.length
      : 0;
    const avgP95 = scenarioResults.length > 0
      ? scenarioResults.reduce((s, r) => s + r.metrics.p95LatencyMs, 0) / scenarioResults.length
      : 0;
    const avgCacheHit = scenarioResults.length > 0
      ? scenarioResults.reduce((s, r) => s + r.metrics.cacheHitRate, 0) / scenarioResults.length
      : 0;
    const passed = scenarioResults.filter((r) => r.passed).length;
    const report: E2ETestSuiteReport = {
      suiteName: 'Multimodal RAG E2E Test Suite',
      timestamp: suiteStart,
      scenarios: scenarioResults,
      summary: {
        totalScenarios: this.scenarios.length,
        passedScenarios: passed,
        failedScenarios: this.scenarios.length - passed,
        passRate: passed / this.scenarios.length,
        totalQueries,
        totalDocuments,
        avgRecallAtK: avgRecall,
        avgP95LatencyMs: avgP95,
        avgCacheHitRate: avgCacheHit,
      },
    };
    this.emit({ type: 'suite-complete', timestamp: Date.now() });
    return report;
  }

  /**
   * 运行单个场景
   */
  async runScenario(scenario: E2EScenario): Promise<E2EScenarioResult> {
    const start = Date.now();
    this.emit({ type: 'scenario-start', timestamp: start, scenarioId: scenario.id });

    const failures: string[] = [];
    const latencies: number[] = [];
    const cacheHits: number[] = [];
    const recallAtKList: number[] = [];
    const precisionAtKList: number[] = [];

    try {
      // 1. 重置索引和缓存
      this.index.clear();
      this.cache.clear();

      // 2. 索引所有文档
      for (const doc of scenario.documents) {
        try {
          await this.index.addDocument({
            id: doc.id,
            primaryModality: doc.modality,
            text: doc.text,
            image: doc.image,
          });
        } catch (err) {
          failures.push(`Failed to index doc ${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 3. 执行所有查询
      for (const query of scenario.queries) {
        const queryStart = Date.now();
        try {
          const input: MultimodalInput = { modality: query.modality, text: query.text, image: query.image };
          // 尝试从缓存获取
          const cached = await this.cache.get(input);
          let result: CrossModalSearchResult[];
          if (cached) {
            cacheHits.push(1);
            result = JSON.parse(cached.entry.value);
          } else {
            cacheHits.push(0);
            // 根据模态选择搜索方法
            if (query.modality === 'text' && query.text) {
              result = await this.index.searchByText(query.text, { topK: this.k });
            } else if (query.modality === 'image' && query.image) {
              result = await this.index.searchByImage(query.image, { topK: this.k });
            } else if (query.text && query.image) {
              result = await this.index.searchByMultimodal(query.text, query.image, { topK: this.k });
            } else {
              result = [];
            }
            // 存入缓存
            await this.cache.set(input, JSON.stringify(result));
          }
          const queryLatency = Date.now() - queryStart;
          latencies.push(queryLatency);

          // 计算 Recall@K 和 Precision@K
          const retrievedIds = result.map((r) => r.document.id);
          const hits = retrievedIds.filter((id) => query.expectedDocIds.includes(id));
          const recall = query.expectedDocIds.length > 0 ? hits.length / query.expectedDocIds.length : 0;
          const precision = retrievedIds.length > 0 ? hits.length / retrievedIds.length : 0;
          recallAtKList.push(recall);
          precisionAtKList.push(precision);
        } catch (err) {
          failures.push(`Query ${query.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 4. 汇总指标
      const recallAtK = recallAtKList.length > 0 ? recallAtKList.reduce((s, r) => s + r, 0) / recallAtKList.length : 0;
      const precisionAtK = precisionAtKList.length > 0 ? precisionAtKList.reduce((s, r) => s + r, 0) / precisionAtKList.length : 0;
      const cacheHitRate = cacheHits.length > 0 ? cacheHits.reduce((s, c) => s + c, 0) / cacheHits.length : 0;
      const p50 = computePercentile(latencies, 50);
      const p95 = computePercentile(latencies, 95);
      const avg = latencies.length > 0 ? latencies.reduce((s, l) => s + l, 0) / latencies.length : 0;

      // 5. 验证期望
      const expectations = scenario.expectations;
      if (expectations.minRecallAtK !== undefined && recallAtK < expectations.minRecallAtK) {
        failures.push(`Recall@K ${recallAtK.toFixed(3)} < expected ${expectations.minRecallAtK}`);
      }
      if (expectations.maxP95LatencyMs !== undefined && p95 > expectations.maxP95LatencyMs) {
        failures.push(`P95 latency ${p95}ms > expected ${expectations.maxP95LatencyMs}ms`);
      }
      if (expectations.minCacheHitRate !== undefined && cacheHitRate < expectations.minCacheHitRate) {
        failures.push(`Cache hit rate ${cacheHitRate.toFixed(3)} < expected ${expectations.minCacheHitRate}`);
      }

      const result: E2EScenarioResult = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        passed: failures.length === 0,
        durationMs: Date.now() - start,
        metrics: {
          recallAtK,
          precisionAtK,
          p50LatencyMs: p50,
          p95LatencyMs: p95,
          avgLatencyMs: avg,
          cacheHitRate,
          totalQueries: scenario.queries.length,
        },
        failures,
      };
      this.emit({ type: 'scenario-complete', timestamp: Date.now(), scenarioId: scenario.id, latencyMs: result.durationMs });
      return result;
    } catch (err) {
      failures.push(`Scenario ${scenario.id} crashed: ${err instanceof Error ? err.message : String(err)}`);
      const result: E2EScenarioResult = {
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        passed: false,
        durationMs: Date.now() - start,
        metrics: {
          recallAtK: 0,
          precisionAtK: 0,
          p50LatencyMs: 0,
          p95LatencyMs: 0,
          avgLatencyMs: 0,
          cacheHitRate: 0,
          totalQueries: scenario.queries.length,
        },
        failures,
      };
      this.emit({ type: 'error', timestamp: Date.now(), scenarioId: scenario.id, error: err instanceof Error ? err.message : String(err) });
      return result;
    }
  }

  // ============================================================
  // 报告导出
  // ============================================================

  /**
   * 导出 Markdown 报告
   */
  exportMarkdown(report: E2ETestSuiteReport): string {
    const lines: string[] = [];
    lines.push(`# ${report.suiteName}`);
    lines.push('');
    lines.push(`**生成时间**: ${new Date(report.timestamp).toISOString()}`);
    lines.push('');
    lines.push('## 汇总');
    lines.push('');
    lines.push(`- 场景总数: ${report.summary.totalScenarios}`);
    lines.push(`- 通过: ${report.summary.passedScenarios} (${(report.summary.passRate * 100).toFixed(1)}%)`);
    lines.push(`- 失败: ${report.summary.failedScenarios}`);
    lines.push(`- 总查询数: ${report.summary.totalQueries}`);
    lines.push(`- 总文档数: ${report.summary.totalDocuments}`);
    lines.push(`- 平均 Recall@K: ${report.summary.avgRecallAtK.toFixed(3)}`);
    lines.push(`- 平均 P95 延迟: ${report.summary.avgP95LatencyMs.toFixed(1)}ms`);
    lines.push(`- 平均缓存命中率: ${(report.summary.avgCacheHitRate * 100).toFixed(1)}%`);
    lines.push('');
    lines.push('## 场景详情');
    lines.push('');
    for (const s of report.scenarios) {
      const status = s.passed ? '✅' : '❌';
      lines.push(`### ${status} ${s.scenarioName} (\`${s.scenarioId}\`)`);
      lines.push('');
      lines.push(`- 耗时: ${s.durationMs}ms`);
      lines.push(`- Recall@K: ${s.metrics.recallAtK.toFixed(3)}`);
      lines.push(`- Precision@K: ${s.metrics.precisionAtK.toFixed(3)}`);
      lines.push(`- P50: ${s.metrics.p50LatencyMs.toFixed(1)}ms / P95: ${s.metrics.p95LatencyMs.toFixed(1)}ms`);
      lines.push(`- 缓存命中率: ${(s.metrics.cacheHitRate * 100).toFixed(1)}%`);
      if (s.failures.length > 0) {
        lines.push('- 失败:');
        for (const f of s.failures) {
          lines.push(`  - ${f}`);
        }
      }
      lines.push('');
    }
    return lines.join('\n');
  }

  /**
   * 导出 JSON 报告
   */
  exportJson(report: E2ETestSuiteReport): string {
    return JSON.stringify(report, null, 2);
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private emit(event: E2EEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略
      }
    }
  }
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建 E2E 测试套件 (使用 CLIP Local Provider)
 */
export function createE2ETestSuite(options?: {
  scenarios?: E2EScenario[];
  k?: number;
}): MultimodalRAGE2ETestSuite {
  // 使用 CLIPLocalProvider 作为底层 Provider, 共享 embedding 空间
  const clipProvider = new CLIPLocalProvider({ modelId: 'clip-vit-b32', dimension: 256 });
  return new MultimodalRAGE2ETestSuite({
    scenarios: options?.scenarios,
    k: options?.k,
  });
}

export { createEcommerceScenario, createKnowledgeBaseScenario, createHybridSearchScenario, createCacheStressScenario };
