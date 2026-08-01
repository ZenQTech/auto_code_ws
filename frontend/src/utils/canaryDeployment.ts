/**
 * # ============================================================
 * # 灰度发布控制器 (Cycle 52 G52-01)
 * # ============================================================
 * # 核心作用：管理灰度发布全生命周期 + 自动回滚触发
 * # 运行流程：
 * #   1. 创建灰度策略 (CanaryStrategy: 流量比例 + 健康阈值)
 * #   2. 渐进式流量切换 (5% → 25% → 50% → 100%)
 * #   3. 实时指标监控 (错误率/延迟/QPS)
 * #   4. 健康度评估 (基于 metric thresholds)
 * #   5. 不健康时自动回滚 (autoRollback=true)
 * #   6. 全程事件订阅 (start/stage-promote/rollback/complete)
 * # 输入参数：CanaryStrategy { name, stages, healthThresholds, autoRollback }
 * # 输出结果：CanaryReport { stage, trafficPercent, healthScore, status, metrics }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-01 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 灰度阶段 */
export interface CanaryStage {
  /** 阶段名称 */
  name: string;
  /** 流量百分比 (0-100) */
  trafficPercent: number;
  /** 阶段持续时间 (毫秒) */
  durationMs: number;
  /** 阶段成功才推进的最小健康分数 (0-1) */
  minHealthScore: number;
}

/** 健康阈值 */
export interface HealthThresholds {
  /** 最大错误率 (0-1) */
  maxErrorRate: number;
  /** 最大 P95 延迟 (毫秒) */
  maxP95LatencyMs: number;
  /** 最小 QPS */
  minQps: number;
  /** 最大 CPU 使用率 (0-1) */
  maxCpuUsage: number;
}

/** 灰度策略 */
export interface CanaryStrategy {
  /** 策略 ID */
  id: string;
  /** 策略名称 */
  name: string;
  /** 服务名称 */
  service: string;
  /** 灰度阶段列表 (按时间顺序) */
  stages: CanaryStage[];
  /** 健康阈值 */
  healthThresholds: HealthThresholds;
  /** 失败时自动回滚 */
  autoRollback: boolean;
  /** 采样间隔 (毫秒) */
  sampleIntervalMs?: number;
  /** 自定义健康度计算函数 */
  healthCalculator?: (metrics: CanaryMetrics) => number;
}

/** 实时指标 */
export interface CanaryMetrics {
  /** 时间戳 */
  timestamp: number;
  /** 错误率 (0-1) */
  errorRate: number;
  /** P95 延迟 (毫秒) */
  p95LatencyMs: number;
  /** QPS */
  qps: number;
  /** CPU 使用率 (0-1) */
  cpuUsage: number;
  /** 健康分数 (0-1) */
  healthScore: number;
}

/** 灰度状态 */
export type CanaryStatus = 'pending' | 'in-progress' | 'promoting' | 'completed' | 'rolled-back' | 'failed';

/** 灰度报告 */
export interface CanaryReport {
  /** 策略 ID */
  strategyId: string;
  /** 服务名称 */
  service: string;
  /** 状态 */
  status: CanaryStatus;
  /** 当前阶段索引 */
  currentStageIndex: number;
  /** 当前流量百分比 */
  currentTrafficPercent: number;
  /** 总耗时 (毫秒) */
  durationMs: number;
  /** 时间戳 */
  timestamp: number;
  /** 阶段结果 */
  stages: Array<{
    name: string;
    trafficPercent: number;
    passed: boolean;
    durationMs: number;
    avgHealthScore: number;
    metrics: CanaryMetrics[];
  }>;
  /** 最终指标 */
  finalMetrics?: CanaryMetrics;
  /** 回滚原因 */
  rollbackReason?: string;
  /** 摘要 */
  summary: string;
  /** 建议 */
  recommendations: string[];
}

/** 事件 */
export type CanaryEvent =
  | { type: 'start'; timestamp: number; strategy: CanaryStrategy }
  | { type: 'stage-start'; timestamp: number; strategyId: string; stage: CanaryStage; stageIndex: number }
  | { type: 'stage-metrics'; timestamp: number; strategyId: string; stageIndex: number; metrics: CanaryMetrics }
  | { type: 'stage-promote'; timestamp: number; strategyId: string; fromStage: number; toStage: number }
  | { type: 'stage-rollback'; timestamp: number; strategyId: string; stageIndex: number; reason: string }
  | { type: 'complete'; timestamp: number; report: CanaryReport };

export type CanaryListener = (event: CanaryEvent) => void;

// ============================================================
// CanaryDeployment 主类
// ============================================================

export class CanaryDeployment {
  private readonly strategy: CanaryStrategy;
  private readonly sampleIntervalMs: number;
  private readonly listeners: Set<CanaryListener> = new Set();
  private running = false;
  private aborted = false;

  constructor(strategy: CanaryStrategy) {
    this.strategy = strategy;
    this.sampleIntervalMs = strategy.sampleIntervalMs ?? 1000;
  }

  /**
   * 订阅事件
   */
  subscribe(listener: CanaryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 执行灰度发布
   */
  async execute(): Promise<CanaryReport> {
    if (this.running) {
      throw new Error('CanaryDeployment is already running');
    }
    this.running = true;
    this.aborted = false;

    const start = Date.now();
    this.emit({ type: 'start', timestamp: start, strategy: this.strategy });

    const stages: CanaryReport['stages'] = [];
    let currentStageIndex = 0;
    let status: CanaryStatus = 'in-progress';
    let rollbackReason: string | undefined;
    let finalMetrics: CanaryMetrics | undefined;

    try {
      for (let i = 0; i < this.strategy.stages.length; i++) {
        if (this.aborted) {
          status = 'failed';
          rollbackReason = 'Deployment aborted by user';
          break;
        }
        currentStageIndex = i;
        const stage = this.strategy.stages[i]!;
        this.emit({ type: 'stage-start', timestamp: Date.now(), strategyId: this.strategy.id, stage, stageIndex: i });

        const stageResult = await this.runStage(stage, i);
        stages.push(stageResult);
        finalMetrics = stageResult.metrics[stageResult.metrics.length - 1];

        // 健康度评估
        if (!stageResult.passed) {
          // 如果是 abort 导致失败，标记为 failed（优先级高于 rolled-back）
          if (this.aborted) {
            status = 'failed';
            rollbackReason = 'Deployment aborted by user';
          } else {
            rollbackReason = `Stage "${stage.name}" failed: health score ${stageResult.avgHealthScore.toFixed(2)} < ${stage.minHealthScore}`;
            this.emit({ type: 'stage-rollback', timestamp: Date.now(), strategyId: this.strategy.id, stageIndex: i, reason: rollbackReason });
            status = this.strategy.autoRollback ? 'rolled-back' : 'failed';
          }
          break;
        }

        if (i < this.strategy.stages.length - 1) {
          this.emit({ type: 'stage-promote', timestamp: Date.now(), strategyId: this.strategy.id, fromStage: i, toStage: i + 1 });
        }
      }

      if (status === 'in-progress') {
        status = 'completed';
        currentStageIndex = this.strategy.stages.length - 1;
      }
    } catch (err) {
      status = 'failed';
      rollbackReason = err instanceof Error ? err.message : String(err);
    } finally {
      this.running = false;
    }

    const report: CanaryReport = {
      strategyId: this.strategy.id,
      service: this.strategy.service,
      status,
      currentStageIndex,
      currentTrafficPercent: this.strategy.stages[currentStageIndex]?.trafficPercent ?? 0,
      durationMs: Date.now() - start,
      timestamp: start,
      stages,
      finalMetrics,
      rollbackReason,
      summary: this.buildSummary(status, stages, rollbackReason),
      recommendations: this.buildRecommendations(status, stages, finalMetrics),
    };

    this.emit({ type: 'complete', timestamp: Date.now(), report });
    return report;
  }

  /**
   * 优雅停止
   */
  abort(): void {
    this.aborted = true;
  }

  /**
   * 执行单个阶段
   */
  private async runStage(stage: CanaryStage, stageIndex: number): Promise<CanaryReport['stages'][number]> {
    const start = Date.now();
    const end = start + stage.durationMs;
    const metrics: CanaryMetrics[] = [];

    while (Date.now() < end) {
      if (this.aborted) break;
      const sample = this.sampleMetrics();
      const healthScore = this.calculateHealth(sample);
      const metricsWithScore: CanaryMetrics = { ...sample, healthScore };
      metrics.push(metricsWithScore);
      this.emit({
        type: 'stage-metrics',
        timestamp: Date.now(),
        strategyId: this.strategy.id,
        stageIndex,
        metrics: metricsWithScore,
      });
      await this.sleep(Math.min(this.sampleIntervalMs, end - Date.now()));
    }

    const avgHealthScore = metrics.length > 0 ? metrics.reduce((s, m) => s + m.healthScore, 0) / metrics.length : 0;
    const passed = avgHealthScore >= stage.minHealthScore && !this.aborted;

    return {
      name: stage.name,
      trafficPercent: stage.trafficPercent,
      passed,
      durationMs: Date.now() - start,
      avgHealthScore,
      metrics,
    };
  }

  /**
   * 采样当前指标 (默认 mock 实现)
   */
  private sampleMetrics(): Omit<CanaryMetrics, 'healthScore'> {
    // 真实实现应从 Prometheus / 监控系统获取
    return {
      timestamp: Date.now(),
      errorRate: Math.random() * 0.05, // 0-5% 错误率
      p95LatencyMs: 50 + Math.random() * 100, // 50-150ms
      qps: 100 + Math.random() * 200, // 100-300 QPS
      cpuUsage: 0.3 + Math.random() * 0.3, // 30-60%
    };
  }

  /**
   * 计算健康分数
   */
  private calculateHealth(metrics: Omit<CanaryMetrics, 'healthScore'>): number {
    if (this.strategy.healthCalculator) {
      return this.strategy.healthCalculator({ ...metrics, healthScore: 0 });
    }
    const t = this.strategy.healthThresholds;
    let score = 1.0;
    if (metrics.errorRate > t.maxErrorRate) score -= (metrics.errorRate - t.maxErrorRate) * 5;
    if (metrics.p95LatencyMs > t.maxP95LatencyMs) score -= ((metrics.p95LatencyMs - t.maxP95LatencyMs) / t.maxP95LatencyMs) * 0.5;
    if (metrics.qps < t.minQps) score -= ((t.minQps - metrics.qps) / t.minQps) * 0.3;
    if (metrics.cpuUsage > t.maxCpuUsage) score -= (metrics.cpuUsage - t.maxCpuUsage) * 0.4;
    return Math.max(0, Math.min(1, score));
  }

  /**
   * 构建摘要
   */
  private buildSummary(status: CanaryStatus, stages: CanaryReport['stages'], rollbackReason?: string): string {
    const statusMap: Record<CanaryStatus, string> = {
      'pending': '⏳ PENDING',
      'in-progress': '🔄 IN PROGRESS',
      'promoting': '🔄 PROMOTING',
      'completed': '✅ COMPLETED',
      'rolled-back': '⏪ ROLLED BACK',
      'failed': '❌ FAILED',
    };
    const passed = stages.filter((s) => s.passed).length;
    const summary = `${statusMap[status]} - ${passed}/${stages.length} stages passed`;
    if (rollbackReason) {
      return `${summary} | Reason: ${rollbackReason}`;
    }
    return summary;
  }

  /**
   * 构建建议
   */
  private buildRecommendations(status: CanaryStatus, stages: CanaryReport['stages'], finalMetrics?: CanaryMetrics): string[] {
    const recs: string[] = [];
    if (status === 'rolled-back' || status === 'failed') {
      recs.push('回滚到稳定版本, 检查失败原因');
      const failedStage = stages.find((s) => !s.passed);
      if (failedStage) {
        recs.push(`失败阶段: ${failedStage.name} (${failedStage.trafficPercent}% 流量)`);
        if (failedStage.avgHealthScore < 0.5) {
          recs.push('健康度过低 (< 0.5), 建议检查新版本代码');
        }
      }
    } else if (status === 'completed') {
      recs.push('灰度发布成功完成, 所有阶段健康度达标');
      if (finalMetrics) {
        if (finalMetrics.errorRate < 0.01) {
          recs.push('错误率 < 1%, 表现优秀');
        } else if (finalMetrics.errorRate < 0.05) {
          recs.push('错误率 < 5%, 表现良好');
        }
      }
    }
    return recs;
  }

  /**
   * 触发事件
   */
  private emit(event: CanaryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略 listener 错误
      }
    }
  }

  /**
   * 睡眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
// 工厂函数
// ====================================

/** 创建灰度策略 */
export function createCanaryStrategy(
  service: string,
  stages?: Partial<CanaryStage>[],
  healthThresholds?: Partial<HealthThresholds>,
  options?: { autoRollback?: boolean; sampleIntervalMs?: number }
): CanaryStrategy {
  const defaultStages: CanaryStage[] = [
    { name: '1% Smoke Test', trafficPercent: 1, durationMs: 5000, minHealthScore: 0.7 },
    { name: '10% Canary', trafficPercent: 10, durationMs: 10000, minHealthScore: 0.7 },
    { name: '50% Half Traffic', trafficPercent: 50, durationMs: 15000, minHealthScore: 0.65 },
    { name: '100% Full Rollout', trafficPercent: 100, durationMs: 10000, minHealthScore: 0.6 },
  ];
  const defaultThresholds: HealthThresholds = {
    maxErrorRate: 0.05,
    maxP95LatencyMs: 500,
    minQps: 50,
    maxCpuUsage: 0.8,
  };
  return {
    id: `canary-${service}-${Date.now()}`,
    name: `Canary deployment for ${service}`,
    service,
    stages: stages
      ? stages.map((s) => ({ ...defaultStages[0]!, ...s }))
      : defaultStages,
    healthThresholds: { ...defaultThresholds, ...healthThresholds },
    autoRollback: options?.autoRollback ?? true,
    sampleIntervalMs: options?.sampleIntervalMs,
  };
}
