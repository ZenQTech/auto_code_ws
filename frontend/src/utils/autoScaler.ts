/**
 * # ============================================================
 * # 自动扩缩容器 (Cycle 52 G52-03)
 * # ============================================================
 * # 核心作用：基于实时指标自动调整服务实例数
 * # 运行流程：
 * #   1. 持续采样指标 (CPU/Memory/QPS/Latency)
 * #   2. 滑动窗口平均值 (避免抖动)
 * #   3. 触发扩缩容规则 (threshold-based)
 * #   4. 计算目标实例数 (考虑冷却期)
 * #   5. 模拟扩缩容操作 (add/remove instances)
 * #   6. 事件订阅 (scale-up/scale-down/cooldown)
 * # 输入参数：ScalingConfig { service, minInstances, maxInstances, thresholds }
 * # 输出结果：ScalingReport { totalActions, finalInstances, history, summary }
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 52 G52-03 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 服务指标 */
export interface ServiceMetrics {
  /** 时间戳 */
  timestamp: number;
  /** CPU 使用率 (0-1) */
  cpuUsage: number;
  /** 内存使用率 (0-1) */
  memoryUsage: number;
  /** QPS */
  qps: number;
  /** 平均延迟 (毫秒) */
  avgLatencyMs: number;
  /** 活跃连接数 */
  activeConnections: number;
}

/** 扩缩容阈值 */
export interface ScalingThresholds {
  /** 扩容触发的 CPU 阈值 (0-1) */
  scaleUpCpu: number;
  /** 扩容触发的内存阈值 (0-1) */
  scaleUpMemory: number;
  /** 扩容触发的 QPS 阈值 */
  scaleUpQps: number;
  /** 扩容触发的延迟阈值 (毫秒) */
  scaleUpLatencyMs: number;
  /** 缩容触发的 CPU 阈值 (0-1) */
  scaleDownCpu: number;
  /** 缩容触发的内存阈值 (0-1) */
  scaleDownMemory: number;
  /** 缩容触发的 QPS 阈值 */
  scaleDownQps: number;
  /** 缩容触发的延迟阈值 (毫秒) */
  scaleDownLatencyMs: number;
}

/** 扩缩容配置 */
export interface ScalingConfig {
  /** 服务名称 */
  service: string;
  /** 最小实例数 */
  minInstances: number;
  /** 最大实例数 */
  maxInstances: number;
  /** 初始实例数 */
  initialInstances: number;
  /** 阈值 */
  thresholds: ScalingThresholds;
  /** 采样间隔 (毫秒) */
  sampleIntervalMs: number;
  /** 滑动窗口大小 */
  windowSize: number;
  /** 冷却期 (毫秒) - 扩缩容后等待时间 */
  cooldownMs: number;
  /** 每次扩缩容步长 (实例数) */
  stepSize: number;
  /** 自定义指标采样函数 */
  metricsProvider?: () => Promise<Omit<ServiceMetrics, 'timestamp'>>;
}

/** 扩缩容操作 */
export interface ScalingAction {
  /** 时间戳 */
  timestamp: number;
  /** 操作类型 */
  type: 'scale-up' | 'scale-down' | 'no-op';
  /** 原因 */
  reason: string;
  /** 之前实例数 */
  fromInstances: number;
  /** 之后实例数 */
  toInstances: number;
  /** 触发指标 */
  metrics: ServiceMetrics;
  /** 窗口平均值 */
  windowAvg: ServiceMetrics;
}

/** 实例状态 */
export interface Instance {
  /** 实例 ID */
  id: string;
  /** 状态 */
  status: 'starting' | 'running' | 'stopping' | 'stopped';
  /** 启动时间 */
  startedAt: number;
  /** 停止时间 */
  stoppedAt?: number;
}

/** 扩缩容报告 */
export interface ScalingReport {
  /** 服务名称 */
  service: string;
  /** 时间戳 */
  timestamp: number;
  /** 总持续时间 (毫秒) */
  durationMs: number;
  /** 初始实例数 */
  initialInstances: number;
  /** 最终实例数 */
  finalInstances: number;
  /** 最小实例数 */
  minInstances: number;
  /** 最大实例数 */
  maxInstances: number;
  /** 扩容次数 */
  scaleUpCount: number;
  /** 缩容次数 */
  scaleDownCount: number;
  /** 无操作次数 */
  noOpCount: number;
  /** 总采样数 */
  totalSamples: number;
  /** 操作历史 */
  history: ScalingAction[];
  /** 摘要 */
  summary: string;
  /** 建议 */
  recommendations: string[];
}

/** 事件 */
export type ScalingEvent =
  | { type: 'start'; timestamp: number; config: ScalingConfig }
  | { type: 'metrics-sampled'; timestamp: number; metrics: ServiceMetrics; windowAvg: ServiceMetrics }
  | { type: 'scale-up'; timestamp: number; action: ScalingAction; newInstances: Instance[] }
  | { type: 'scale-down'; timestamp: number; action: ScalingAction; newInstances: Instance[] }
  | { type: 'cooldown'; timestamp: number; remainingMs: number }
  | { type: 'complete'; timestamp: number; report: ScalingReport };

export type ScalingListener = (event: ScalingEvent) => void;

// ============================================================
// AutoScaler 主类
// ============================================================

export class AutoScaler {
  private readonly config: ScalingConfig;
  private readonly instances: Map<string, Instance> = new Map();
  private readonly listeners: Set<ScalingListener> = new Set();
  private readonly metricsWindow: ServiceMetrics[] = [];
  private readonly history: ScalingAction[] = [];
  private lastActionTime = 0;
  private currentInstances: number;
  private instanceCounter = 0;
  private running = false;
  private aborted = false;
  private scaleUpCount = 0;
  private scaleDownCount = 0;
  private noOpCount = 0;

  constructor(config: ScalingConfig) {
    this.config = config;
    this.currentInstances = config.initialInstances;
    this.initializeInstances();
  }

  /**
   * 初始化实例
   */
  private initializeInstances(): void {
    for (let i = 0; i < this.currentInstances; i++) {
      const instance: Instance = {
        id: `${this.config.service}-${++this.instanceCounter}`,
        status: 'running',
        startedAt: Date.now(),
      };
      this.instances.set(instance.id, instance);
    }
  }

  /**
   * 订阅事件
   */
  subscribe(listener: ScalingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取当前实例数
   */
  getCurrentInstances(): number {
    return this.currentInstances;
  }

  /**
   * 获取所有实例
   */
  getInstances(): Instance[] {
    return Array.from(this.instances.values());
  }

  /**
   * 启动扩缩容循环
   */
  async start(durationMs: number): Promise<ScalingReport> {
    if (this.running) {
      throw new Error('AutoScaler is already running');
    }
    this.running = true;
    this.aborted = false;

    const start = Date.now();
    const end = start + durationMs;
    this.emit({ type: 'start', timestamp: start, config: this.config });

    let totalSamples = 0;
    while (Date.now() < end && !this.aborted) {
      // 采样
      const sample = await this.sampleMetrics();
      const windowAvg = this.updateWindow(sample);
      totalSamples++;

      this.emit({
        type: 'metrics-sampled',
        timestamp: Date.now(),
        metrics: sample,
        windowAvg,
      });

      // 检查冷却期
      if (Date.now() - this.lastActionTime < this.config.cooldownMs) {
        const remaining = this.config.cooldownMs - (Date.now() - this.lastActionTime);
        this.emit({ type: 'cooldown', timestamp: Date.now(), remainingMs: remaining });
      } else {
        // 评估是否需要扩缩容
        const action = this.evaluate(windowAvg);
        if (action.type !== 'no-op') {
          this.history.push(action);
          if (action.type === 'scale-up') {
            this.scaleUpInstances(action);
            this.scaleUpCount++;
          } else {
            this.scaleDownInstances(action);
            this.scaleDownCount++;
          }
          this.lastActionTime = Date.now();
        } else {
          this.noOpCount++;
        }
      }

      await this.sleep(this.config.sampleIntervalMs);
    }

    const report: ScalingReport = {
      service: this.config.service,
      timestamp: start,
      durationMs: Date.now() - start,
      initialInstances: this.config.initialInstances,
      finalInstances: this.currentInstances,
      minInstances: this.config.minInstances,
      maxInstances: this.config.maxInstances,
      scaleUpCount: this.scaleUpCount,
      scaleDownCount: this.scaleDownCount,
      noOpCount: this.noOpCount,
      totalSamples,
      history: this.history,
      summary: this.buildSummary(),
      recommendations: this.buildRecommendations(),
    };

    this.running = false;
    this.emit({ type: 'complete', timestamp: Date.now(), report });
    return report;
  }

  /**
   * 优雅停止
   */
  abort(): void {
    this.aborted = true;
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private async sampleMetrics(): Promise<ServiceMetrics> {
    if (this.config.metricsProvider) {
      const m = await this.config.metricsProvider();
      return { ...m, timestamp: Date.now() };
    }
    // 默认 mock 实现
    return {
      timestamp: Date.now(),
      cpuUsage: 0.3 + Math.random() * 0.5, // 30-80%
      memoryUsage: 0.4 + Math.random() * 0.4, // 40-80%
      qps: 50 + Math.random() * 200, // 50-250
      avgLatencyMs: 50 + Math.random() * 200, // 50-250ms
      activeConnections: this.currentInstances * 10,
    };
  }

  private updateWindow(sample: ServiceMetrics): ServiceMetrics {
    this.metricsWindow.push(sample);
    if (this.metricsWindow.length > this.config.windowSize) {
      this.metricsWindow.shift();
    }
    const window = this.metricsWindow;
    const avg: ServiceMetrics = {
      timestamp: Date.now(),
      cpuUsage: window.reduce((s, m) => s + m.cpuUsage, 0) / window.length,
      memoryUsage: window.reduce((s, m) => s + m.memoryUsage, 0) / window.length,
      qps: window.reduce((s, m) => s + m.qps, 0) / window.length,
      avgLatencyMs: window.reduce((s, m) => s + m.avgLatencyMs, 0) / window.length,
      activeConnections: window.reduce((s, m) => s + m.activeConnections, 0) / window.length,
    };
    return avg;
  }

  private evaluate(metrics: ServiceMetrics): ScalingAction {
    const t = this.config.thresholds;
    const reasons: string[] = [];
    let direction: 'up' | 'down' | 'none' = 'none';

    // 扩容评估
    if (metrics.cpuUsage > t.scaleUpCpu) reasons.push(`CPU ${(metrics.cpuUsage * 100).toFixed(1)}% > ${(t.scaleUpCpu * 100).toFixed(1)}%`);
    if (metrics.memoryUsage > t.scaleUpMemory) reasons.push(`Memory ${(metrics.memoryUsage * 100).toFixed(1)}% > ${(t.scaleUpMemory * 100).toFixed(1)}%`);
    if (metrics.qps > t.scaleUpQps) reasons.push(`QPS ${metrics.qps.toFixed(0)} > ${t.scaleUpQps}`);
    if (metrics.avgLatencyMs > t.scaleUpLatencyMs) reasons.push(`Latency ${metrics.avgLatencyMs.toFixed(0)}ms > ${t.scaleUpLatencyMs}ms`);

    if (reasons.length > 0 && this.currentInstances < this.config.maxInstances) {
      direction = 'up';
    } else {
      // 缩容评估 (所有指标都低于缩容阈值)
      reasons.length = 0;
      if (metrics.cpuUsage < t.scaleDownCpu) reasons.push(`CPU ${(metrics.cpuUsage * 100).toFixed(1)}% < ${(t.scaleDownCpu * 100).toFixed(1)}%`);
      if (metrics.memoryUsage < t.scaleDownMemory) reasons.push(`Memory ${(metrics.memoryUsage * 100).toFixed(1)}% < ${(t.scaleDownMemory * 100).toFixed(1)}%`);
      if (metrics.qps < t.scaleDownQps) reasons.push(`QPS ${metrics.qps.toFixed(0)} < ${t.scaleDownQps}`);
      if (metrics.avgLatencyMs < t.scaleDownLatencyMs) reasons.push(`Latency ${metrics.avgLatencyMs.toFixed(0)}ms < ${t.scaleDownLatencyMs}ms`);

      // 至少 3 个指标低于缩容阈值才缩容
      if (reasons.length >= 3 && this.currentInstances > this.config.minInstances) {
        direction = 'down';
      }
    }

    if (direction === 'up') {
      const newCount = Math.min(this.config.maxInstances, this.currentInstances + this.config.stepSize);
      return {
        timestamp: Date.now(),
        type: 'scale-up',
        reason: reasons.join(', '),
        fromInstances: this.currentInstances,
        toInstances: newCount,
        metrics: this.metricsWindow[this.metricsWindow.length - 1]!,
        windowAvg: metrics,
      };
    } else if (direction === 'down') {
      const newCount = Math.max(this.config.minInstances, this.currentInstances - this.config.stepSize);
      return {
        timestamp: Date.now(),
        type: 'scale-down',
        reason: reasons.join(', '),
        fromInstances: this.currentInstances,
        toInstances: newCount,
        metrics: this.metricsWindow[this.metricsWindow.length - 1]!,
        windowAvg: metrics,
      };
    } else {
      return {
        timestamp: Date.now(),
        type: 'no-op',
        reason: 'All metrics within normal range',
        fromInstances: this.currentInstances,
        toInstances: this.currentInstances,
        metrics: this.metricsWindow[this.metricsWindow.length - 1]!,
        windowAvg: metrics,
      };
    }
  }

  private scaleUpInstances(action: ScalingAction): void {
    for (let i = 0; i < this.config.stepSize && this.instances.size < this.config.maxInstances; i++) {
      const instance: Instance = {
        id: `${this.config.service}-${++this.instanceCounter}`,
        status: 'running',
        startedAt: Date.now(),
      };
      this.instances.set(instance.id, instance);
    }
    this.currentInstances = this.instances.size;
    this.emit({
      type: 'scale-up',
      timestamp: Date.now(),
      action,
      newInstances: this.getInstances(),
    });
  }

  private scaleDownInstances(action: ScalingAction): void {
    const runningInstances = this.getInstances().filter((i) => i.status === 'running');
    for (let i = 0; i < this.config.stepSize && this.instances.size > this.config.minInstances && i < runningInstances.length; i++) {
      const instance = runningInstances[i]!;
      instance.status = 'stopped';
      instance.stoppedAt = Date.now();
      this.instances.delete(instance.id);
    }
    this.currentInstances = this.instances.size;
    this.emit({
      type: 'scale-down',
      timestamp: Date.now(),
      action,
      newInstances: this.getInstances(),
    });
  }

  private buildSummary(): string {
    return `Auto-scaling for ${this.config.service}: ${this.config.initialInstances} → ${this.currentInstances} instances (↑${this.scaleUpCount} ↓${this.scaleDownCount} noop=${this.noOpCount})`;
  }

  private buildRecommendations(): string[] {
    const recs: string[] = [];
    if (this.scaleUpCount > this.scaleDownCount * 2) {
      recs.push('扩容频繁, 考虑提高初始实例数或调整阈值');
    }
    if (this.scaleDownCount > this.scaleUpCount * 2) {
      recs.push('缩容频繁, 考虑降低初始实例数或调整阈值');
    }
    if (this.currentInstances === this.config.maxInstances) {
      recs.push('达到最大实例数, 考虑提高 maxInstances 上限或优化服务');
    }
    if (this.currentInstances === this.config.minInstances) {
      recs.push('处于最小实例数, 流量低时可考虑关闭多余实例');
    }
    if (recs.length === 0) {
      recs.push('扩缩容稳定, 无需调整');
    }
    return recs;
  }

  private emit(event: ScalingEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================
// 工厂函数
// ====================================

/** 创建默认扩缩容配置 */
export function createDefaultScalingConfig(
  service: string,
  overrides?: Partial<ScalingConfig>
): ScalingConfig {
  return {
    service,
    minInstances: 1,
    maxInstances: 10,
    initialInstances: 2,
    thresholds: {
      scaleUpCpu: 0.7,
      scaleUpMemory: 0.8,
      scaleUpQps: 200,
      scaleUpLatencyMs: 300,
      scaleDownCpu: 0.3,
      scaleDownMemory: 0.4,
      scaleDownQps: 50,
      scaleDownLatencyMs: 100,
    },
    sampleIntervalMs: 1000,
    windowSize: 5,
    cooldownMs: 5000,
    stepSize: 1,
    ...overrides,
  };
}
