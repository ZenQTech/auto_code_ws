/**
 * # ============================================================
 * # 性能压测器 (Cycle 51 G51-04)
 * # ============================================================
 * # 核心作用：执行性能压测 + 生成 P50/P95/P99 报告
 * #           支持并发请求 + 持续时间控制 + 错误统计
 * # 运行流程：
 * #   1. 启动 N 个并发 worker, 每个 worker 持续发送请求
 * #   2. 收集每次请求的延迟 + 状态码
 * #   3. 计算 QPS + P50/P95/P99 + 错误率
 * #   4. 输出性能报告 (Markdown / JSON)
 * # 输入参数：url, connections, duration, method, body
 * # 输出结果：PerfReport { qps, p50, p95, p99, errorRate, ... }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 51 G51-04 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 压测配置 */
export interface LoadTestConfig {
  /** 目标 URL */
  url: string;
  /** HTTP 方法 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** 请求体 */
  body?: unknown;
  /** 请求头 */
  headers?: Record<string, string>;
  /** 并发连接数 */
  connections: number;
  /** 压测持续时间 (毫秒) */
  durationMs: number;
  /** 预热时间 (毫秒) - 不计入统计 */
  warmupMs?: number;
  /** 请求超时 (毫秒) */
  requestTimeoutMs?: number;
  /** 期望 QPS (用于判定通过) */
  expectedQps?: number;
  /** 期望 P95 延迟 (毫秒) */
  expectedP95Ms?: number;
  /** 期望错误率上限 (0-1) */
  maxErrorRate?: number;
  /** 进度回调 */
  onProgress?: (progress: LoadTestProgress) => void;
  /** fetch 实现 (可注入) */
  fetchImpl?: typeof fetch;
  /** 信号 - 用于提前终止 */
  signal?: AbortSignal;
}

/** 压测进度 */
export interface LoadTestProgress {
  /** 已运行时间 (毫秒) */
  elapsedMs: number;
  /** 总目标时间 */
  totalMs: number;
  /** 已完成请求数 */
  completedRequests: number;
  /** 当前 QPS 估算 */
  currentQps: number;
  /** 进度百分比 0-100 */
  percent: number;
}

/** 单次请求结果 */
export interface RequestResult {
  /** 状态码 */
  statusCode: number;
  /** 延迟 (毫秒) */
  latencyMs: number;
  /** 是否错误 (status >= 400) */
  isError: boolean;
  /** 错误信息 */
  error?: string;
  /** 时间戳 */
  timestamp: number;
}

/** 性能报告 */
export interface PerfReport {
  /** 配置摘要 */
  config: {
    url: string;
    method: string;
    connections: number;
    durationMs: number;
  };
  /** 时间戳 */
  timestamp: number;
  /** 总耗时 (含预热) */
  totalDurationMs: number;
  /** 实际压测耗时 */
  actualDurationMs: number;
  /** 总请求数 */
  totalRequests: number;
  /** 成功请求数 */
  successfulRequests: number;
  /** 错误请求数 */
  failedRequests: number;
  /** 错误率 (0-1) */
  errorRate: number;
  /** QPS (queries per second) */
  qps: number;
  /** P50 延迟 (毫秒) */
  p50LatencyMs: number;
  /** P75 延迟 */
  p75LatencyMs: number;
  /** P90 延迟 */
  p90LatencyMs: number;
  /** P95 延迟 */
  p95LatencyMs: number;
  /** P99 延迟 */
  p99LatencyMs: number;
  /** 最小延迟 */
  minLatencyMs: number;
  /** 最大延迟 */
  maxLatencyMs: number;
  /** 平均延迟 */
  avgLatencyMs: number;
  /** 状态码分布 */
  statusCodeDistribution: Record<number, number>;
  /** 错误列表 (前 10 个) */
  errors: Array<{ statusCode: number; error: string; count: number }>;
  /** 是否通过 (基于预期) */
  passed: boolean;
  /** 期望检查结果 */
  expectationResults: Array<{
    metric: string;
    expected: number;
    actual: number;
    passed: boolean;
  }>;
  /** 摘要 */
  summary: string;
}

// ============================================================
// LoadTester 主类
// ============================================================

export class LoadTester {
  private running = false;
  private aborted = false;

  /**
   * 执行压测
   */
  async run(config: LoadTestConfig): Promise<PerfReport> {
    if (this.running) {
      throw new Error('LoadTester is already running');
    }
    this.running = true;
    this.aborted = false;

    const start = Date.now();
    const warmupMs = config.warmupMs ?? 0;
    const requestTimeoutMs = config.requestTimeoutMs ?? 10000;
    const fetchImpl = config.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : (() => { throw new Error('fetch not available'); }) as unknown as typeof fetch);

    // 1. 预热阶段
    if (warmupMs > 0) {
      await this.warmup(config, warmupMs, requestTimeoutMs, fetchImpl);
    }

    // 2. 正式压测
    const testStart = Date.now();
    const testEnd = testStart + config.durationMs;
    const results: RequestResult[] = [];
    const progressInterval = Math.max(100, Math.floor(config.durationMs / 100)); // 100 个进度点

    // 启动并发 worker
    const workers: Promise<void>[] = [];
    for (let i = 0; i < config.connections; i++) {
      workers.push(this.worker(config, testStart, testEnd, results, requestTimeoutMs, fetchImpl));
    }

    // 进度监控
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    if (config.onProgress) {
      progressTimer = setInterval(() => {
        if (this.aborted) return;
        const elapsed = Date.now() - testStart;
        const percent = Math.min(100, Math.floor((elapsed / config.durationMs) * 100));
        const completed = results.length;
        const currentQps = elapsed > 0 ? (completed / elapsed) * 1000 : 0;
        config.onProgress!({
          elapsedMs: elapsed,
          totalMs: config.durationMs,
          completedRequests: completed,
          currentQps,
          percent,
        });
      }, progressInterval);
    }

    // 监听 abort 信号
    let abortHandler: (() => void) | null = null;
    if (config.signal) {
      abortHandler = () => {
        this.aborted = true;
      };
      config.signal.addEventListener('abort', abortHandler);
    }

    // 等待所有 worker 完成
    try {
      await Promise.all(workers);
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      if (config.signal && abortHandler) {
        config.signal.removeEventListener('abort', abortHandler);
      }
      this.running = false;
    }

    const actualDurationMs = Date.now() - testStart;

    // 3. 计算统计
    return this.buildReport(config, results, start, actualDurationMs);
  }

  /**
   * 预热阶段
   */
  private async warmup(
    config: LoadTestConfig,
    durationMs: number,
    timeoutMs: number,
    fetchImpl: typeof fetch
  ): Promise<void> {
    const start = Date.now();
    const end = start + durationMs;
    const init: RequestInit = {
      method: config.method ?? 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...config.headers },
    };
    if (config.body && config.method !== 'GET') {
      init.body = JSON.stringify(config.body);
    }
    while (Date.now() < end && !this.aborted) {
      try {
        await fetchImpl(config.url, init);
      } catch {
        // 忽略预热错误
      }
    }
  }

  /**
   * 单个 worker
   */
  private async worker(
    config: LoadTestConfig,
    startTime: number,
    endTime: number,
    results: RequestResult[],
    timeoutMs: number,
    fetchImpl: typeof fetch
  ): Promise<void> {
    const init: RequestInit = {
      method: config.method ?? 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...config.headers },
    };
    if (config.body && config.method !== 'GET') {
      init.body = JSON.stringify(config.body);
    }

    while (Date.now() < endTime && !this.aborted) {
      const reqStart = Date.now();
      try {
        const res = await fetchImpl(config.url, init);
        const latency = Date.now() - reqStart;
        results.push({
          statusCode: res.status,
          latencyMs: latency,
          isError: res.status >= 400,
          timestamp: reqStart,
        });
      } catch (err) {
        const latency = Date.now() - reqStart;
        results.push({
          statusCode: 0,
          latencyMs: latency,
          isError: true,
          error: err instanceof Error ? err.message : String(err),
          timestamp: reqStart,
        });
      }
      // 让出事件循环, 允许 setInterval 触发 (用于 onProgress 回调)
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  /**
   * 构建报告
   */
  private buildReport(
    config: LoadTestConfig,
    results: RequestResult[],
    startTime: number,
    actualDurationMs: number
  ): PerfReport {
    const totalRequests = results.length;
    const successfulRequests = results.filter((r) => !r.isError).length;
    const failedRequests = totalRequests - successfulRequests;
    const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;
    const qps = actualDurationMs > 0 ? (totalRequests / actualDurationMs) * 1000 : 0;

    // 延迟统计
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = computePercentile(latencies, 50);
    const p75 = computePercentile(latencies, 75);
    const p90 = computePercentile(latencies, 90);
    const p95 = computePercentile(latencies, 95);
    const p99 = computePercentile(latencies, 99);
    const minLat = latencies[0] ?? 0;
    const maxLat = latencies[latencies.length - 1] ?? 0;
    const avgLat = totalRequests > 0 ? latencies.reduce((s, l) => s + l, 0) / totalRequests : 0;

    // 状态码分布
    const statusCodeDistribution: Record<number, number> = {};
    for (const r of results) {
      statusCodeDistribution[r.statusCode] = (statusCodeDistribution[r.statusCode] ?? 0) + 1;
    }

    // 错误聚合
    const errorMap = new Map<string, { statusCode: number; error: string; count: number }>();
    for (const r of results) {
      if (r.isError) {
        const key = `${r.statusCode}:${r.error ?? 'unknown'}`;
        const existing = errorMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          errorMap.set(key, { statusCode: r.statusCode, error: r.error ?? 'unknown', count: 1 });
        }
      }
    }
    const errors = Array.from(errorMap.values()).sort((a, b) => b.count - a.count).slice(0, 10);

    // 期望检查
    const expectationResults: PerfReport['expectationResults'] = [];
    if (config.expectedQps !== undefined) {
      expectationResults.push({
        metric: 'qps',
        expected: config.expectedQps,
        actual: qps,
        passed: qps >= config.expectedQps,
      });
    }
    if (config.expectedP95Ms !== undefined) {
      expectationResults.push({
        metric: 'p95_latency_ms',
        expected: config.expectedP95Ms,
        actual: p95,
        passed: p95 <= config.expectedP95Ms,
      });
    }
    if (config.maxErrorRate !== undefined) {
      expectationResults.push({
        metric: 'error_rate',
        expected: config.maxErrorRate,
        actual: errorRate,
        passed: errorRate <= config.maxErrorRate,
      });
    }
    const passed = expectationResults.every((e) => e.passed) || expectationResults.length === 0;

    const summary = [
      `QPS: ${qps.toFixed(1)}`,
      `P50: ${p50.toFixed(1)}ms`,
      `P95: ${p95.toFixed(1)}ms`,
      `P99: ${p99.toFixed(1)}ms`,
      `Error: ${(errorRate * 100).toFixed(2)}%`,
      passed ? '✅ PASSED' : '❌ FAILED',
    ].join(' | ');

    return {
      config: {
        url: config.url,
        method: config.method ?? 'GET',
        connections: config.connections,
        durationMs: config.durationMs,
      },
      timestamp: startTime,
      totalDurationMs: Date.now() - startTime,
      actualDurationMs,
      totalRequests,
      successfulRequests,
      failedRequests,
      errorRate,
      qps,
      p50LatencyMs: p50,
      p75LatencyMs: p75,
      p90LatencyMs: p90,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      minLatencyMs: minLat,
      maxLatencyMs: maxLat,
      avgLatencyMs: avgLat,
      statusCodeDistribution,
      errors,
      passed,
      expectationResults,
      summary,
    };
  }
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 计算百分位 (使用线性插值法, 更接近 Excel PERCENTILE / numpy percentile)
 */
export function computePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;
  const rank = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;
  if (lower === upper) {
    return sortedValues[lower]!;
  }
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

// ============================================================
// 报告导出
// ============================================================

/**
 * 导出为 Markdown
 */
export function exportPerfReportMarkdown(report: PerfReport): string {
  const lines: string[] = [];
  const status = report.passed ? '✅ PASSED' : '❌ FAILED';
  lines.push(`# 性能压测报告`);
  lines.push('');
  lines.push(`**状态**: ${status}`);
  lines.push(`**目标**: ${report.config.method} ${report.config.url}`);
  lines.push(`**并发**: ${report.config.connections} | **持续**: ${report.config.durationMs}ms (实际 ${report.actualDurationMs}ms)`);
  lines.push(`**时间**: ${new Date(report.timestamp).toISOString()}`);
  lines.push('');
  lines.push(`## 摘要`);
  lines.push(report.summary);
  lines.push('');
  lines.push(`## 关键指标`);
  lines.push(`| 指标 | 数值 |`);
  lines.push(`|------|------|`);
  lines.push(`| 总请求 | ${report.totalRequests} |`);
  lines.push(`| 成功 | ${report.successfulRequests} |`);
  lines.push(`| 失败 | ${report.failedRequests} |`);
  lines.push(`| 错误率 | ${(report.errorRate * 100).toFixed(2)}% |`);
  lines.push(`| QPS | ${report.qps.toFixed(2)} |`);
  lines.push(`| P50 延迟 | ${report.p50LatencyMs.toFixed(2)} ms |`);
  lines.push(`| P75 延迟 | ${report.p75LatencyMs.toFixed(2)} ms |`);
  lines.push(`| P90 延迟 | ${report.p90LatencyMs.toFixed(2)} ms |`);
  lines.push(`| P95 延迟 | ${report.p95LatencyMs.toFixed(2)} ms |`);
  lines.push(`| P99 延迟 | ${report.p99LatencyMs.toFixed(2)} ms |`);
  lines.push(`| 最小延迟 | ${report.minLatencyMs.toFixed(2)} ms |`);
  lines.push(`| 最大延迟 | ${report.maxLatencyMs.toFixed(2)} ms |`);
  lines.push(`| 平均延迟 | ${report.avgLatencyMs.toFixed(2)} ms |`);
  lines.push('');
  lines.push(`## 状态码分布`);
  for (const [code, count] of Object.entries(report.statusCodeDistribution).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    lines.push(`- HTTP ${code}: ${count}`);
  }
  if (report.errors.length > 0) {
    lines.push('');
    lines.push(`## 错误 (Top 10)`);
    for (const e of report.errors) {
      lines.push(`- HTTP ${e.statusCode} (${e.count} 次): ${e.error}`);
    }
  }
  if (report.expectationResults.length > 0) {
    lines.push('');
    lines.push(`## 期望检查`);
    lines.push(`| 指标 | 期望 | 实际 | 通过 |`);
    lines.push(`|------|------|------|------|`);
    for (const r of report.expectationResults) {
      const icon = r.passed ? '✅' : '❌';
      lines.push(`| ${r.metric} | ${r.expected} | ${r.actual.toFixed(2)} | ${icon} |`);
    }
  }
  return lines.join('\n');
}

// ============================================================
// 工厂函数
// ============================================================

/**
 * 创建 LoadTester 实例
 */
export function createLoadTester(): LoadTester {
  return new LoadTester();
}
