/**
 * # ============================================================
 * # HookPerformanceAnalyzer - Hook 性能分析器 (v1.0.0 Cycle 22 G22-03)
 * # ============================================================
 * # 核心作用：基于 HookChainTracker 采集的执行数据，分析 Hook 性能
 * #           识别慢节点、失败率高节点，生成优化建议并支持报告导出
 * # 业务价值：
 * #   1. 自动识别慢节点（> 平均时长 2x）
 * #   2. 识别超时节点（> 配置阈值）
 * #   3. 失败率统计（失败次数 / 总执行次数）
 * #   4. 5 种严重级别：critical / high / medium / low / info
 * #   5. 优化建议生成（5 类：retry / timeout / rewrite / merge / split）
 * #   6. 支持 json / html / markdown 3 种导出格式
 * # 运行流程：
 * #   1. ingestExecutionData() - 从 HookChainTracker 摄入执行数据
 * #   2. analyzeSlowNodes() - 慢节点分析
 * #   3. analyzeFailureRate() - 失败率分析
 * #   4. generateOptimizations() - 生成优化建议
 * #   5. exportReport(format) - 导出报告
 * # 输入参数：
 * #   - Hook 执行数据 (chainId, hookId, durationMs, status, error)
 * #   - 慢节点阈值 (slowThresholdMs, slowMultiplier)
 * # 输出结果：
 * #   - PerformanceReport: 性能报告
 * #   - SlowNode: 慢节点列表
 * #   - OptimizationSuggestion: 优化建议
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 22 G22-03 初次创建
 * #     - HookPerformanceAnalyzer 核心引擎
 * #     - 慢节点检测（> 平均时长 2x）
 * #     - 失败率统计（按 hook / hook type 维度）
 * #     - 5 种优化建议类型
 * #     - 3 种报告导出格式
 * #     - 单例工厂 + 事件订阅
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

/** Hook 执行状态（从 HookChainTracker 同步） */
export type HookExecutionStatus =
  | 'success'
  | 'failed'
  | 'timeout'
  | 'pending'
  | 'running'
  | 'cancelled';

/** 严重级别 */
export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** 优化建议类型 */
export type OptimizationType =
  | 'retry'
  | 'timeout-adjust'
  | 'rewrite'
  | 'merge'
  | 'split'
  | 'disable'
  | 'cache'
  | 'async-io';

/** 报告格式 */
export type ReportFormat = 'json' | 'html' | 'markdown';

/** Hook 执行记录（从 HookChainTracker 同步） */
export interface HookExecutionRecord {
  executionId: string;
  chainId: string;
  hookId: string;
  hookName: string;
  hookType: string;
  durationMs: number;
  status: HookExecutionStatus;
  timestamp: number;
  error?: string;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

/** 慢节点 */
export interface SlowNode {
  hookId: string;
  hookName: string;
  hookType: string;
  averageDurationMs: number;
  medianDurationMs: number;
  p95DurationMs: number;
  maxDurationMs: number;
  executionCount: number;
  slowdownFactor: number; // 与平均的比值
  severity: SeverityLevel;
  sampleExecutionIds: string[];
}

/** 失败率分析结果 */
export interface FailureRateReport {
  hookId: string;
  hookName: string;
  hookType: string;
  totalExecutions: number;
  failedExecutions: number;
  timeoutExecutions: number;
  failureRate: number; // 0-1
  timeoutRate: number; // 0-1
  severity: SeverityLevel;
  commonErrors: Array<{ message: string; count: number }>;
  sampleFailedExecutionIds: string[];
}

/** 优化建议 */
export interface OptimizationSuggestion {
  suggestionId: string;
  targetHookId: string;
  type: OptimizationType;
  severity: SeverityLevel;
  title: string;
  description: string;
  rationale: string;
  estimatedImprovement: string; // 预估提升描述
  applied?: boolean;
  appliedAt?: number;
}

/** 性能报告 */
export interface PerformanceReport {
  reportId: string;
  generatedAt: number;
  totalExecutions: number;
  totalChains: number;
  totalHooks: number;
  averageDurationMs: number;
  p95DurationMs: number;
  overallFailureRate: number;
  slowNodes: SlowNode[];
  failureReports: FailureRateReport[];
  suggestions: OptimizationSuggestion[];
  summary: {
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
  };
}

/** 性能分析器配置 */
export interface PerformanceAnalyzerConfig {
  /** 慢节点倍数（默认 2x） */
  slowMultiplier: number;
  /** 慢节点最低时长（ms，默认 100ms） */
  slowThresholdMs: number;
  /** 慢节点最低执行次数（默认 3 次） */
  minExecutionsForAnalysis: number;
  /** 失败率告警阈值（默认 10%） */
  failureRateThreshold: number;
  /** 严重失败率阈值（默认 30%） */
  criticalFailureRateThreshold: number;
  /** 慢节点 TOP N（默认 10） */
  topSlowNodes: number;
  /** 最大存储执行记录数（默认 5000） */
  maxRecords: number;
}

/** 报告导出选项 */
export interface ReportExportOptions {
  format: ReportFormat;
  includeRawData?: boolean;
  includeOptimizations?: boolean;
}

/** 分析器事件类型 */
export type AnalyzerEventType =
  | 'record-ingested'
  | 'analysis-completed'
  | 'report-generated'
  | 'suggestion-applied'
  | 'config-updated';

/** 分析器事件 */
export interface AnalyzerEvent {
  type: AnalyzerEventType;
  timestamp: number;
  data?: Record<string, unknown>;
}

/** 事件处理器 */
export type AnalyzerEventHandler = (event: AnalyzerEvent) => void;

// ============================================================================
// 事件总线
// ============================================================================

class PerformanceAnalyzerEventBus {
  private listeners: Map<AnalyzerEventType, Set<AnalyzerEventHandler>> = new Map();

  on(type: AnalyzerEventType, handler: AnalyzerEventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => {
      this.listeners.get(type)?.delete(handler);
    };
  }

  emit(event: AnalyzerEvent): void {
    this.listeners.get(event.type)?.forEach((handler) => {
      try {
        handler(event);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Analyzer event handler error:', err);
      }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function _genId(prefix: string = 'perf'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 计算数组中位数
 */
function _median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 计算数组 P95
 */
function _percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

/**
 * 根据失败率返回严重级别
 */
function _severityForFailureRate(rate: number, criticalThreshold: number, warningThreshold: number): SeverityLevel {
  if (rate >= criticalThreshold) return 'critical';
  if (rate >= warningThreshold) return 'high';
  if (rate >= warningThreshold / 2) return 'medium';
  if (rate > 0) return 'low';
  return 'info';
}

/**
 * 根据慢速倍数返回严重级别
 */
function _severityForSlowdown(factor: number): SeverityLevel {
  if (factor >= 5) return 'critical';
  if (factor >= 3) return 'high';
  if (factor >= 2) return 'medium';
  return 'low';
}

// ============================================================================
// 核心类
// ============================================================================

/**
 * HookPerformanceAnalyzer 性能分析器
 *
 * 基于 HookChainTracker 采集的执行数据，识别性能瓶颈并生成优化建议
 */
export class HookPerformanceAnalyzer {
  /** 执行记录存储 */
  private records: HookExecutionRecord[] = [];
  /** 报告缓存 */
  private reports: Map<string, PerformanceReport> = new Map();
  /** 当前配置 */
  private config: PerformanceAnalyzerConfig;
  /** 事件总线 */
  private readonly eventBus: PerformanceAnalyzerEventBus = new PerformanceAnalyzerEventBus();

  constructor(config?: Partial<PerformanceAnalyzerConfig>) {
    this.config = {
      slowMultiplier: 2.0,
      slowThresholdMs: 100,
      minExecutionsForAnalysis: 3,
      failureRateThreshold: 0.1,
      criticalFailureRateThreshold: 0.3,
      topSlowNodes: 10,
      maxRecords: 5000,
      ...config,
    };
  }

  // --------------------------------------------------------------------------
  // 数据摄入
  // --------------------------------------------------------------------------

  /**
   * 摄入单条执行记录
   */
  ingestRecord(record: HookExecutionRecord): void {
    if (!record.executionId || !record.hookId) {
      throw new Error('Invalid record: missing executionId or hookId');
    }
    this.records.push(record);

    // 限制最大记录数（FIFO）
    if (this.records.length > this.config.maxRecords) {
      this.records = this.records.slice(-this.config.maxRecords);
    }

    this.eventBus.emit({
      type: 'record-ingested',
      timestamp: Date.now(),
      data: { executionId: record.executionId, hookId: record.hookId },
    });
  }

  /**
   * 批量摄入执行记录
   */
  ingestRecords(records: HookExecutionRecord[]): number {
    if (!Array.isArray(records)) {
      throw new Error('Records must be an array');
    }
    let ingested = 0;
    for (const r of records) {
      try {
        this.ingestRecord(r);
        ingested += 1;
      } catch {
        // 跳过无效记录
      }
    }
    return ingested;
  }

  /**
   * 从模拟数据源生成测试数据
   */
  generateMockData(
    chainCount: number = 5,
    hooksPerChain: number = 4,
    executionsPerHook: number = 10
  ): HookExecutionRecord[] {
    const hookTypes = [
      'before_prompt',
      'after_prompt',
      'before_response',
      'after_response',
      'thinking',
      'tool_execution',
    ];
    const hookNames = [
      'validate-prompt',
      'enrich-context',
      'sanitize-output',
      'log-metrics',
      'format-response',
      'track-usage',
    ];
    const records: HookExecutionRecord[] = [];

    for (let c = 0; c < chainCount; c += 1) {
      const chainId = _genId('chain');
      for (let h = 0; h < hooksPerChain; h += 1) {
        const hookId = `${chainId}-hook-${h}`;
        const hookName = `${hookNames[h % hookNames.length]}-${h}`;
        const hookType = hookTypes[h % hookTypes.length];
        for (let e = 0; e < executionsPerHook; e += 1) {
          // 模拟性能特征：某些 Hook 显著慢
          const baseDuration = 30 + Math.random() * 80;
          const isSlowHook = h === 1; // 第二个 Hook 模拟为慢节点
          const duration = isSlowHook
            ? baseDuration * (3 + Math.random() * 2) // 3-5x 慢
            : baseDuration;
          // 模拟失败：某些 Hook 失败率高
          const isFailingHook = h === 2; // 第三个 Hook 模拟失败
          const isFailure = isFailingHook && Math.random() < 0.4;
          const isTimeout = !isFailure && Math.random() < 0.05;
          const status: HookExecutionStatus = isFailure
            ? 'failed'
            : isTimeout
              ? 'timeout'
              : 'success';

          records.push({
            executionId: _genId('exec'),
            chainId,
            hookId,
            hookName,
            hookType,
            durationMs: Math.round(duration),
            status,
            timestamp: Date.now() - Math.floor(Math.random() * 86400000),
            error: status === 'failed' ? 'Mock failure: connection reset' : undefined,
            retryCount: status === 'failed' ? Math.floor(Math.random() * 2) : 0,
          });
        }
      }
    }

    this.ingestRecords(records);
    return records;
  }

  // --------------------------------------------------------------------------
  // 分析
  // --------------------------------------------------------------------------

  /**
   * 慢节点分析
   */
  analyzeSlowNodes(): SlowNode[] {
    const minExecs = this.config.minExecutionsForAnalysis;
    const minDuration = this.config.slowThresholdMs;
    const multiplier = this.config.slowMultiplier;

    // 按 hookId 分组
    const grouped: Map<string, HookExecutionRecord[]> = new Map();
    for (const r of this.records) {
      if (!grouped.has(r.hookId)) {
        grouped.set(r.hookId, []);
      }
      grouped.get(r.hookId)!.push(r);
    }

    // 计算全局平均时长
    let totalSum = 0;
    let totalCount = 0;
    for (const r of this.records) {
      totalSum += r.durationMs;
      totalCount += 1;
    }
    const globalAverage = totalCount > 0 ? totalSum / totalCount : 0;

    const slowNodes: SlowNode[] = [];
    for (const [hookId, recs] of grouped.entries()) {
      if (recs.length < minExecs) continue;
      const durations = recs.map((r) => r.durationMs);
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      // 慢节点条件：平均时长超过全局平均 * multiplier 或 超过最低阈值
      const factor = globalAverage > 0 ? avg / globalAverage : 0;
      if (factor >= multiplier || avg >= minDuration * multiplier) {
        const sampleExecutions = recs.slice(0, 3).map((r) => r.executionId);
        slowNodes.push({
          hookId,
          hookName: recs[0].hookName,
          hookType: recs[0].hookType,
          averageDurationMs: Math.round(avg),
          medianDurationMs: Math.round(_median(durations)),
          p95DurationMs: Math.round(_percentile(durations, 95)),
          maxDurationMs: Math.round(Math.max(...durations)),
          executionCount: recs.length,
          slowdownFactor: Math.round(factor * 100) / 100,
          severity: _severityForSlowdown(factor),
          sampleExecutionIds: sampleExecutions,
        });
      }
    }

    // 按 slowdownFactor 降序，取 TOP N
    return slowNodes
      .sort((a, b) => b.slowdownFactor - a.slowdownFactor)
      .slice(0, this.config.topSlowNodes);
  }

  /**
   * 失败率分析
   */
  analyzeFailureRate(): FailureRateReport[] {
    const minExecs = this.config.minExecutionsForAnalysis;
    const grouped: Map<string, HookExecutionRecord[]> = new Map();
    for (const r of this.records) {
      if (!grouped.has(r.hookId)) {
        grouped.set(r.hookId, []);
      }
      grouped.get(r.hookId)!.push(r);
    }

    const reports: FailureRateReport[] = [];
    for (const [hookId, recs] of grouped.entries()) {
      if (recs.length < minExecs) continue;
      const failed = recs.filter((r) => r.status === 'failed');
      const timedOut = recs.filter((r) => r.status === 'timeout');
      const failureRate = failed.length / recs.length;
      const timeoutRate = timedOut.length / recs.length;

      // 统计常见错误
      const errorCounts: Map<string, number> = new Map();
      for (const r of failed) {
        const msg = r.error || 'Unknown error';
        errorCounts.set(msg, (errorCounts.get(msg) || 0) + 1);
      }
      const commonErrors = Array.from(errorCounts.entries())
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      if (failureRate >= this.config.failureRateThreshold || timeoutRate >= this.config.failureRateThreshold) {
        const combinedRate = failureRate + timeoutRate;
        reports.push({
          hookId,
          hookName: recs[0].hookName,
          hookType: recs[0].hookType,
          totalExecutions: recs.length,
          failedExecutions: failed.length,
          timeoutExecutions: timedOut.length,
          failureRate: Math.round(failureRate * 1000) / 1000,
          timeoutRate: Math.round(timeoutRate * 1000) / 1000,
          severity: _severityForFailureRate(
            combinedRate,
            this.config.criticalFailureRateThreshold,
            this.config.failureRateThreshold
          ),
          commonErrors,
          sampleFailedExecutionIds: failed.slice(0, 3).map((r) => r.executionId),
        });
      }
    }

    return reports.sort((a, b) => b.failureRate - a.failureRate);
  }

  /**
   * 生成优化建议
   */
  generateOptimizations(
    slowNodes: SlowNode[],
    failureReports: FailureRateReport[]
  ): OptimizationSuggestion[] {
    const suggestions: OptimizationSuggestion[] = [];

    // 慢节点优化建议
    for (const node of slowNodes) {
      if (node.slowdownFactor >= 5) {
        // 严重慢节点：建议重写或拆分
        suggestions.push({
          suggestionId: _genId('sug'),
          targetHookId: node.hookId,
          type: 'rewrite',
          severity: 'critical',
          title: `重写 ${node.hookName}`,
          description: `该 Hook 平均耗时 ${node.averageDurationMs}ms，是全局平均的 ${node.slowdownFactor}x，建议重写或拆分。`,
          rationale: `P95 耗时 ${node.p95DurationMs}ms，最大 ${node.maxDurationMs}ms，对实时性能影响显著。`,
          estimatedImprovement: '预计可减少 50-70% 耗时',
        });
      } else if (node.slowdownFactor >= 3) {
        suggestions.push({
          suggestionId: _genId('sug'),
          targetHookId: node.hookId,
          type: 'split',
          severity: 'high',
          title: `拆分 ${node.hookName}`,
          description: `建议将 Hook 拆分为并行子任务或异步执行。`,
          rationale: `当前耗时是平均的 ${node.slowdownFactor}x，可通过并行化提升。`,
          estimatedImprovement: '预计可减少 30-50% 耗时',
        });
      } else if (node.slowdownFactor >= 2) {
        suggestions.push({
          suggestionId: _genId('sug'),
          targetHookId: node.hookId,
          type: 'cache',
          severity: 'medium',
          title: `缓存 ${node.hookName} 输出`,
          description: `建议增加结果缓存避免重复计算。`,
          rationale: `慢节点通常意味着昂贵计算，缓存命中率高的场景收益明显。`,
          estimatedImprovement: '预计可减少 20-40% 耗时',
        });
      }
    }

    // 失败率优化建议
    for (const report of failureReports) {
      if (report.severity === 'critical') {
        suggestions.push({
          suggestionId: _genId('sug'),
          targetHookId: report.hookId,
          type: 'retry',
          severity: 'critical',
          title: `为 ${report.hookName} 启用重试`,
          description: `失败率 ${(report.failureRate * 100).toFixed(1)}% 严重过高，需要立即优化。`,
          rationale: `常见错误：${report.commonErrors[0]?.message || '未知'}，建议重试 + 熔断。`,
          estimatedImprovement: '预计可降低失败率至 5% 以下',
        });
        suggestions.push({
          suggestionId: _genId('sug'),
          targetHookId: report.hookId,
          type: 'timeout-adjust',
          severity: 'high',
          title: `调整 ${report.hookName} 超时阈值`,
          description: `超时率 ${(report.timeoutRate * 100).toFixed(1)}%，建议提高超时阈值或优化内部 IO。`,
          rationale: '超时通常是 IO 阻塞或资源不足的信号。',
          estimatedImprovement: '预计可减少 50% 超时',
        });
      } else if (report.severity === 'high') {
        suggestions.push({
          suggestionId: _genId('sug'),
          targetHookId: report.hookId,
          type: 'async-io',
          severity: 'high',
          title: `${report.hookName} 改为异步 IO`,
          description: `失败率 ${(report.failureRate * 100).toFixed(1)}%，建议将阻塞 IO 改为异步。`,
          rationale: '异步 IO 可显著降低连接超时等失败场景。',
          estimatedImprovement: '预计可降低失败率 30-50%',
        });
      } else if (report.severity === 'medium') {
        suggestions.push({
          suggestionId: _genId('sug'),
          targetHookId: report.hookId,
          type: 'timeout-adjust',
          severity: 'medium',
          title: `${report.hookName} 调优超时配置`,
          description: `失败率 ${(report.failureRate * 100).toFixed(1)}%，建议微调超时和重试参数。`,
          rationale: '中度失败率通常由参数配置不当引起。',
          estimatedImprovement: '预计可降低失败率 20-30%',
        });
      }
    }

    // 合并相邻 Hook 建议（同一 hookType 多个慢节点）
    const typeCount: Map<string, SlowNode[]> = new Map();
    for (const node of slowNodes) {
      if (!typeCount.has(node.hookType)) {
        typeCount.set(node.hookType, []);
      }
      typeCount.get(node.hookType)!.push(node);
    }
    for (const [hookType, nodes] of typeCount.entries()) {
      if (nodes.length >= 3) {
        suggestions.push({
          suggestionId: _genId('sug'),
          targetHookId: nodes[0].hookId,
          type: 'merge',
          severity: 'low',
          title: `合并 ${hookType} 类型 Hook`,
          description: `检测到 ${nodes.length} 个同类型慢 Hook，建议合并实现。`,
          rationale: '合并可减少重复的上下文加载和初始化开销。',
          estimatedImprovement: '预计可减少 15-25% 总耗时',
        });
      }
    }

    return suggestions.sort((a, b) => {
      const order: Record<SeverityLevel, number> = {
        critical: 0, high: 1, medium: 2, low: 3, info: 4,
      };
      return order[a.severity] - order[b.severity];
    });
  }

  /**
   * 生成完整性能报告
   */
  generateReport(): PerformanceReport {
    const slowNodes = this.analyzeSlowNodes();
    const failureReports = this.analyzeFailureRate();
    const suggestions = this.generateOptimizations(slowNodes, failureReports);

    const totalExecutions = this.records.length;
    const totalChains = new Set(this.records.map((r) => r.chainId)).size;
    const totalHooks = new Set(this.records.map((r) => r.hookId)).size;
    const totalDuration = this.records.reduce((sum, r) => sum + r.durationMs, 0);
    const averageDurationMs = totalExecutions > 0 ? Math.round(totalDuration / totalExecutions) : 0;
    const p95DurationMs = Math.round(_percentile(this.records.map((r) => r.durationMs), 95));
    const failedCount = this.records.filter((r) => r.status === 'failed' || r.status === 'timeout').length;
    const overallFailureRate = totalExecutions > 0 ? Math.round((failedCount / totalExecutions) * 1000) / 1000 : 0;

    // 汇总严重级别
    const allSeverities: SeverityLevel[] = [
      ...slowNodes.map((n) => n.severity),
      ...failureReports.map((r) => r.severity),
      ...suggestions.map((s) => s.severity),
    ];
    const summary = {
      criticalCount: allSeverities.filter((s) => s === 'critical').length,
      highCount: allSeverities.filter((s) => s === 'high').length,
      mediumCount: allSeverities.filter((s) => s === 'medium').length,
      lowCount: allSeverities.filter((s) => s === 'low').length,
      infoCount: allSeverities.filter((s) => s === 'info').length,
    };

    const report: PerformanceReport = {
      reportId: _genId('report'),
      generatedAt: Date.now(),
      totalExecutions,
      totalChains,
      totalHooks,
      averageDurationMs,
      p95DurationMs,
      overallFailureRate,
      slowNodes,
      failureReports,
      suggestions,
      summary,
    };

    this.reports.set(report.reportId, report);

    this.eventBus.emit({
      type: 'analysis-completed',
      timestamp: Date.now(),
      data: { reportId: report.reportId },
    });
    this.eventBus.emit({
      type: 'report-generated',
      timestamp: Date.now(),
      data: { reportId: report.reportId, suggestionCount: suggestions.length },
    });

    return report;
  }

  // --------------------------------------------------------------------------
  // 报告导出
  // --------------------------------------------------------------------------

  /**
   * 导出报告
   */
  exportReport(reportId: string, options: ReportExportOptions): string {
    const report = this.reports.get(reportId);
    if (!report) {
      throw new Error(`Report not found: ${reportId}`);
    }
    switch (options.format) {
      case 'json':
        return this._exportJson(report, options);
      case 'html':
        return this._exportHtml(report, options);
      case 'markdown':
        return this._exportMarkdown(report, options);
      default:
        throw new Error(`Unsupported format: ${options.format}`);
    }
  }

  /**
   * 导出 JSON 格式
   */
  private _exportJson(report: PerformanceReport, options: ReportExportOptions): string {
    const data: Record<string, unknown> = {
      reportId: report.reportId,
      generatedAt: report.generatedAt,
      summary: report.summary,
      totalExecutions: report.totalExecutions,
      totalChains: report.totalChains,
      totalHooks: report.totalHooks,
      averageDurationMs: report.averageDurationMs,
      p95DurationMs: report.p95DurationMs,
      overallFailureRate: report.overallFailureRate,
    };
    if (options.includeRawData !== false) {
      data.slowNodes = report.slowNodes;
      data.failureReports = report.failureReports;
    }
    if (options.includeOptimizations !== false) {
      data.suggestions = report.suggestions;
    }
    return JSON.stringify(data, null, 2);
  }

  /**
   * 导出 HTML 格式
   */
  private _exportHtml(report: PerformanceReport, options: ReportExportOptions): string {
    const suggestionsHtml = options.includeOptimizations !== false
      ? report.suggestions.map((s) => `
        <div class="suggestion severity-${s.severity}">
          <h3>${s.title}</h3>
          <p>${s.description}</p>
          <p><strong>理由：</strong>${s.rationale}</p>
          <p><strong>预计提升：</strong>${s.estimatedImprovement}</p>
        </div>
      `).join('')
      : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Hook 性能分析报告 - ${report.reportId}</title>
  <style>
    body { font-family: sans-serif; margin: 24px; }
    h1, h2 { color: #333; }
    .summary { display: flex; gap: 16px; margin: 16px 0; }
    .stat { padding: 12px; border-radius: 8px; background: #f5f5f5; }
    .severity-critical { border-left: 4px solid #dc2626; }
    .severity-high { border-left: 4px solid #ea580c; }
    .severity-medium { border-left: 4px solid #ca8a04; }
    .severity-low { border-left: 4px solid #65a30d; }
    .suggestion { padding: 12px; margin: 8px 0; background: #fafafa; }
  </style>
</head>
<body>
  <h1>Hook 性能分析报告</h1>
  <p>报告 ID: ${report.reportId}</p>
  <p>生成时间: ${new Date(report.generatedAt).toISOString()}</p>
  <div class="summary">
    <div class="stat">总执行: ${report.totalExecutions}</div>
    <div class="stat">总链路: ${report.totalChains}</div>
    <div class="stat">总 Hook: ${report.totalHooks}</div>
    <div class="stat">平均耗时: ${report.averageDurationMs}ms</div>
    <div class="stat">P95 耗时: ${report.p95DurationMs}ms</div>
    <div class="stat">失败率: ${(report.overallFailureRate * 100).toFixed(1)}%</div>
  </div>
  <h2>慢节点 (${report.slowNodes.length})</h2>
  <ul>
    ${report.slowNodes.map((n) => `<li>${n.hookName}: ${n.averageDurationMs}ms (${n.slowdownFactor}x) - ${n.severity}</li>`).join('')}
  </ul>
  <h2>失败率分析 (${report.failureReports.length})</h2>
  <ul>
    ${report.failureReports.map((f) => `<li>${f.hookName}: ${(f.failureRate * 100).toFixed(1)}% 失败 - ${f.severity}</li>`).join('')}
  </ul>
  <h2>优化建议 (${report.suggestions.length})</h2>
  ${suggestionsHtml}
</body>
</html>`;
  }

  /**
   * 导出 Markdown 格式
   */
  private _exportMarkdown(report: PerformanceReport, options: ReportExportOptions): string {
    const suggestionsMd = options.includeOptimizations !== false
      ? report.suggestions.map((s) => `
### ${s.title} [${s.severity}]

${s.description}

- **理由**: ${s.rationale}
- **预计提升**: ${s.estimatedImprovement}
- **目标 Hook**: \`${s.targetHookId}\`
`).join('\n')
      : '';

    return `# Hook 性能分析报告

**报告 ID**: ${report.reportId}  
**生成时间**: ${new Date(report.generatedAt).toISOString()}

## 概览

| 指标 | 值 |
|------|------|
| 总执行数 | ${report.totalExecutions} |
| 总链路数 | ${report.totalChains} |
| 总 Hook 数 | ${report.totalHooks} |
| 平均耗时 | ${report.averageDurationMs}ms |
| P95 耗时 | ${report.p95DurationMs}ms |
| 总体失败率 | ${(report.overallFailureRate * 100).toFixed(1)}% |

## 严重度汇总

- 🔴 Critical: ${report.summary.criticalCount}
- 🟠 High: ${report.summary.highCount}
- 🟡 Medium: ${report.summary.mediumCount}
- 🟢 Low: ${report.summary.lowCount}
- ⚪ Info: ${report.summary.infoCount}

## 慢节点 (${report.slowNodes.length})

| Hook | 类型 | 平均耗时 | 倍数 | 严重度 |
|------|------|---------|------|--------|
${report.slowNodes.map((n) => `| ${n.hookName} | ${n.hookType} | ${n.averageDurationMs}ms | ${n.slowdownFactor}x | ${n.severity} |`).join('\n')}

## 失败率分析 (${report.failureReports.length})

| Hook | 失败率 | 超时率 | 严重度 |
|------|--------|--------|--------|
${report.failureReports.map((f) => `| ${f.hookName} | ${(f.failureRate * 100).toFixed(1)}% | ${(f.timeoutRate * 100).toFixed(1)}% | ${f.severity} |`).join('\n')}

## 优化建议 (${report.suggestions.length})
${suggestionsMd}
`;
  }

  // --------------------------------------------------------------------------
  // 建议管理
  // --------------------------------------------------------------------------

  /**
   * 标记建议为已应用
   */
  markSuggestionApplied(reportId: string, suggestionId: string): boolean {
    const report = this.reports.get(reportId);
    if (!report) return false;
    const suggestion = report.suggestions.find((s) => s.suggestionId === suggestionId);
    if (!suggestion) return false;
    suggestion.applied = true;
    suggestion.appliedAt = Date.now();
    this.eventBus.emit({
      type: 'suggestion-applied',
      timestamp: Date.now(),
      data: { reportId, suggestionId },
    });
    return true;
  }

  // --------------------------------------------------------------------------
  // 查询与配置
  // --------------------------------------------------------------------------

  /**
   * 获取执行记录
   */
  getRecords(filter?: { hookId?: string; status?: HookExecutionStatus; sinceMs?: number }): HookExecutionRecord[] {
    if (!filter) return [...this.records];
    return this.records.filter((r) => {
      if (filter.hookId && r.hookId !== filter.hookId) return false;
      if (filter.status && r.status !== filter.status) return false;
      if (filter.sinceMs && r.timestamp < filter.sinceMs) return false;
      return true;
    });
  }

  /**
   * 获取已生成的报告
   */
  getReport(reportId: string): PerformanceReport | null {
    return this.reports.get(reportId) || null;
  }

  /**
   * 列出所有报告
   */
  listReports(): PerformanceReport[] {
    return Array.from(this.reports.values()).sort((a, b) => b.generatedAt - a.generatedAt);
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<PerformanceAnalyzerConfig>): void {
    this.config = { ...this.config, ...config };
    this.eventBus.emit({
      type: 'config-updated',
      timestamp: Date.now(),
      data: { config: this.config },
    });
  }

  /**
   * 获取当前配置
   */
  getConfig(): PerformanceAnalyzerConfig {
    return { ...this.config };
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.records = [];
    this.reports.clear();
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    recordCount: number;
    reportCount: number;
    hookCount: number;
    chainCount: number;
  } {
    return {
      recordCount: this.records.length,
      reportCount: this.reports.size,
      hookCount: new Set(this.records.map((r) => r.hookId)).size,
      chainCount: new Set(this.records.map((r) => r.chainId)).size,
    };
  }

  /**
   * 订阅事件
   */
  on(type: AnalyzerEventType, handler: AnalyzerEventHandler): () => void {
    return this.eventBus.on(type, handler);
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: HookPerformanceAnalyzer | null = null;

/**
 * 获取 HookPerformanceAnalyzer 单例
 */
export function getHookPerformanceAnalyzer(): HookPerformanceAnalyzer {
  if (!_instance) {
    _instance = new HookPerformanceAnalyzer();
  }
  return _instance;
}

/**
 * 重置单例（用于测试）
 */
export function resetHookPerformanceAnalyzer(): void {
  if (_instance) {
    _instance.clear();
  }
  _instance = null;
}
