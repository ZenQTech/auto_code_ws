/**
 * # ============================================================
 * # SLO/SLI 计算器 + 错误预算跟踪 (Cycle 53 G53-03)
 * # ============================================================
 * # 核心作用：
 * #   1. SLI (Service Level Indicator) - 服务质量指标
 * #   2. SLO (Service Level Objective) - 服务质量目标
 * #   3. Error Budget - 错误预算计算与跟踪
 * #   4. Burn Rate - 预算消耗速率检测
 * # 参考 Google SRE Workbook
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 53 G53-03 初次创建
 * # ====================================
 */

// ============================================================
// 类型定义
// ============================================================

/** SLI 类型 */
export type SLIType = 'availability' | 'latency' | 'throughput' | 'correctness' | 'freshness' | 'custom';

/** SLI 定义 */
export interface SLIDefinition {
  /** SLI ID */
  id: string;
  /** 名称 */
  name: string;
  /** 类型 */
  type: SLIType;
  /** 描述 */
  description: string;
  /** 良好事件计数查询 (PromQL) */
  goodQuery: string;
  /** 总事件计数查询 (PromQL) */
  totalQuery: string;
  /** 单位 */
  unit: string;
  /** 自定义单位 */
  customUnit?: string;
}

/** SLO 目标 */
export interface SLOTarget {
  /** SLO 名称 */
  name: string;
  /** SLI 引用 */
  sliId: string;
  /** 目标值 (0-1, 例如 0.999 = 99.9%) */
  target: number;
  /** 时间窗口 */
  window: SLIWindow;
  /** 是否启用 */
  enabled: boolean;
}

/** SLO 时间窗口 */
export interface SLIWindow {
  /** 窗口类型 */
  type: 'rolling' | 'calendar';
  /** 持续时间 (毫秒) */
  durationMs: number;
  /** 描述 */
  description: string;
}

/** 错误预算 */
export interface ErrorBudget {
  /** 预算总量 */
  total: number;
  /** 已消耗 */
  consumed: number;
  /** 剩余 */
  remaining: number;
  /** 消耗百分比 (0-1) */
  consumedRatio: number;
  /** 状态 */
  status: 'healthy' | 'warning' | 'critical' | 'exhausted';
  /** 预计耗尽时间 (毫秒时间戳) */
  projectedExhaustionMs?: number;
  /** 实际良好事件数 */
  goodEvents: number;
  /** 实际总事件数 */
  totalEvents: number;
}

/** SLO 报告 */
export interface SLOReport {
  /** SLO 名称 */
  name: string;
  /** SLI 值 (0-1) */
  sliValue: number;
  /** 目标值 (0-1) */
  target: number;
  /** 是否满足 */
  met: boolean;
  /** 当前错误预算 */
  errorBudget: ErrorBudget;
  /** 燃烧率 (1.0 = 恰好维持, >1 = 加速消耗) */
  burnRate: number;
  /** 燃烧率告警级别 */
  burnRateAlert: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** 趋势 (向上/向下) */
  trend: 'improving' | 'degrading' | 'stable';
  /** 时间窗口 */
  window: SLIWindow;
  /** 时间戳 */
  timestamp: number;
}

/** 多 SLI 数据点 (用于计算 SLI 值) */
export interface SLIDataPoint {
  /** 良好事件数 */
  good: number;
  /** 总事件数 */
  total: number;
  /** 时间戳 */
  timestamp: number;
}

/** SLO 事件 */
export type SLOEvent =
  | { type: 'slo-created'; timestamp: number; slo: SLOTarget; sli: SLIDefinition }
  | { type: 'budget-updated'; timestamp: number; sloName: string; consumed: number; total: number }
  | { type: 'budget-exhausted'; timestamp: number; sloName: string }
  | { type: 'burn-rate-alert'; timestamp: number; sloName: string; burnRate: number; level: SLOReport['burnRateAlert'] }
  | { type: 'slo-violation'; timestamp: number; sloName: string; sliValue: number; target: number }
  | { type: 'slo-recovered'; timestamp: number; sloName: string };

export type SLOListener = (event: SLOEvent) => void;

// ============================================================
// 工厂函数
// ====================================

/** 创建 SLI 定义 */
export function createSLI(definition: Omit<SLIDefinition, 'id'> & { id?: string }): SLIDefinition {
  return {
    id: definition.id ?? `sli-${definition.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
    ...definition,
  };
}

/** 创建 SLO 目标 */
export function createSLO(target: Omit<SLOTarget, 'window'> & { window?: Partial<SLIWindow> }): SLOTarget {
  return {
    ...target,
    window: {
      type: target.window?.type ?? 'rolling',
      durationMs: target.window?.durationMs ?? 30 * 24 * 60 * 60 * 1000, // 30天
      description: target.window?.description ?? '30 days rolling window',
    },
  };
}

// ============================================================
// SLO 计算器
// ====================================

/**
 * SLOCalculator - SLO/SLI 计算引擎
 */
export class SLOCalculator {
  private readonly slis: Map<string, SLIDefinition> = new Map();
  private readonly slos: Map<string, SLOTarget> = new Map();
  /** SLO 数据点 (时间序列) */
  private readonly dataPoints: Map<string, SLIDataPoint[]> = new Map();
  /** 预算消耗历史 */
  private readonly budgetHistory: Map<string, { timestamp: number; consumed: number }[]> = new Map();
  private readonly listeners: Set<SLOListener> = new Set();

  /**
   * 注册 SLI
   */
  registerSLI(sli: SLIDefinition): void {
    this.slis.set(sli.id, sli);
    if (!this.dataPoints.has(sli.id)) {
      this.dataPoints.set(sli.id, []);
    }
  }

  /**
   * 注册 SLO
   */
  registerSLO(slo: SLOTarget): void {
    this.slos.set(slo.name, slo);
    if (!this.budgetHistory.has(slo.name)) {
      this.budgetHistory.set(slo.name, []);
    }
    const sli = this.slis.get(slo.sliId);
    if (sli) {
      this.emit({ type: 'slo-created', timestamp: Date.now(), slo, sli });
    }
  }

  /**
   * 记录数据点
   */
  recordDataPoint(sliId: string, good: number, total: number, timestamp: number = Date.now()): void {
    const points = this.dataPoints.get(sliId);
    if (!points) {
      this.dataPoints.set(sliId, []);
    }
    this.dataPoints.get(sliId)!.push({ good, total, timestamp });

    // 限制历史数据点数量
    const allPoints = this.dataPoints.get(sliId)!;
    if (allPoints.length > 10000) {
      allPoints.shift();
    }

    // 更新相关 SLO
    for (const slo of this.slis.get(sliId) ? this.findSLOsBySLI(sliId) : []) {
      this.updateBudget(slo);
    }
  }

  /**
   * 计算 SLI 值
   */
  calculateSLI(sliId: string, windowMs?: number): number {
    const points = this.dataPoints.get(sliId);
    if (!points || points.length === 0) return 1.0;

    const now = Date.now();
    const start = windowMs !== undefined ? now - windowMs : 0;
    const relevant = points.filter((p) => p.timestamp >= start);

    if (relevant.length === 0) return 1.0;
    const totalGood = relevant.reduce((s, p) => s + p.good, 0);
    const totalEvents = relevant.reduce((s, p) => s + p.total, 0);
    if (totalEvents === 0) return 1.0;
    return totalGood / totalEvents;
  }

  /**
   * 计算错误预算
   */
  calculateErrorBudget(sloName: string): ErrorBudget | null {
    const slo = this.slos.get(sloName);
    if (!slo) return null;
    const sli = this.slis.get(slo.sliId);
    if (!sli) return null;

    const events = this.aggregateEvents(slo.sliId, slo.window.durationMs);
    const totalEvents = events.total;
    const goodEvents = events.good;
    const errorEvents = totalEvents - goodEvents;
    const sliValue = totalEvents > 0 ? goodEvents / totalEvents : 1;

    // 允许的错误率 = 1 - SLO 目标
    const allowedErrorRate = 1 - slo.target;
    const allowedErrors = Math.floor(allowedErrorRate * totalEvents);
    const totalBudget = Math.max(1, allowedErrors);
    const consumed = errorEvents;
    const remaining = Math.max(0, totalBudget - consumed);
    const consumedRatio = consumed / totalBudget;

    let status: ErrorBudget['status'] = 'healthy';
    if (consumedRatio >= 1.0) status = 'exhausted';
    else if (consumedRatio >= 0.9) status = 'critical';
    else if (consumedRatio >= 0.7) status = 'warning';

    let projectedExhaustionMs: number | undefined;
    if (consumedRatio > 0 && consumedRatio < 1) {
      const elapsed = slo.window.durationMs;
      const rate = consumed / elapsed;
      const remaining_errors = totalBudget - consumed;
      const projectedDuration = remaining_errors / rate;
      projectedExhaustionMs = Date.now() + projectedDuration;
    }

    return {
      total: totalBudget,
      consumed,
      remaining,
      consumedRatio,
      status,
      projectedExhaustionMs,
      goodEvents,
      totalEvents,
    };
  }

  /**
   * 计算燃烧率 (Burn Rate)
   * 1.0 = 恰好在窗口结束时耗尽预算
   * > 1.0 = 加速消耗
   * < 1.0 = 缓慢消耗
   */
  calculateBurnRate(sloName: string): number {
    const slo = this.slios(sloName);
    if (!slo) return 0;
    const sli = this.slis.get(slo.sliId);
    if (!sli) return 0;

    // 短期窗口 (1h) 与长期窗口 (window) 的比较
    const longSLI = this.calculateSLI(slo.sliId, slo.window.durationMs);
    const shortSLI = this.calculateSLI(slo.sliId, 60 * 60 * 1000);

    if (longSLI >= 1.0) return 0;
    const longErrorRate = 1 - longSLI;
    const shortErrorRate = 1 - shortSLI;
    const targetErrorRate = 1 - slo.target;

    if (targetErrorRate === 0) return Infinity;
    return (shortErrorRate / targetErrorRate) * (slo.window.durationMs / (60 * 60 * 1000));
  }

  /**
   * 生成 SLO 报告
   */
  generateReport(sloName: string): SLOReport | null {
    const slo = this.slios(sloName);
    if (!slo) return null;
    const sliValue = this.calculateSLI(slo.sliId, slo.window.durationMs);
    const budget = this.calculateErrorBudget(sloName);
    if (!budget) return null;
    const burnRate = this.calculateBurnRate(sloName);
    const burnRateAlert = this.classifyBurnRate(burnRate, slo.target);
    const trend = this.calculateTrend(slo.sliId);

    return {
      name: sloName,
      sliValue,
      target: slo.target,
      met: sliValue >= slo.target,
      errorBudget: budget,
      burnRate,
      burnRateAlert,
      trend,
      window: slo.window,
      timestamp: Date.now(),
    };
  }

  /**
   * 订阅事件
   */
  subscribe(listener: SLOListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 获取所有 SLO
   */
  getSLOs(): SLOTarget[] {
    return Array.from(this.slos.values());
  }

  /**
   * 获取所有 SLI
   */
  getSLIs(): SLIDefinition[] {
    return Array.from(this.slis.values());
  }

  /**
   * 获取数据点
   */
  getDataPoints(sliId: string): SLIDataPoint[] {
    return [...(this.dataPoints.get(sliId) ?? [])];
  }

  /**
   * 获取预算历史
   */
  getBudgetHistory(sloName: string): { timestamp: number; consumed: number }[] {
    return [...(this.budgetHistory.get(sloName) ?? [])];
  }

  /**
   * 检查所有 SLO 并发出告警
   */
  checkAndAlert(): void {
    for (const sloName of this.slos.keys()) {
      const report = this.generateReport(sloName);
      if (!report) continue;

      if (report.burnRateAlert !== 'none' && report.burnRateAlert !== 'low') {
        this.emit({
          type: 'burn-rate-alert',
          timestamp: Date.now(),
          sloName,
          burnRate: report.burnRate,
          level: report.burnRateAlert,
        });
      }

      if (!report.met) {
        this.emit({
          type: 'slo-violation',
          timestamp: Date.now(),
          sloName,
          sliValue: report.sliValue,
          target: report.target,
        });
      }

      if (report.errorBudget.status === 'exhausted') {
        this.emit({ type: 'budget-exhausted', timestamp: Date.now(), sloName });
      }
    }
  }

  // ============================================================
  // 私有方法
  // ============================================================

  private findSLOsBySLI(sliId: string): SLOTarget[] {
    return Array.from(this.slos.values()).filter((s) => s.sliId === sliId);
  }

  private aggregateEvents(sliId: string, windowMs: number): { good: number; total: number } {
    const points = this.dataPoints.get(sliId);
    if (!points) return { good: 0, total: 0 };
    const now = Date.now();
    const start = now - windowMs;
    const relevant = points.filter((p) => p.timestamp >= start);
    return {
      good: relevant.reduce((s, p) => s + p.good, 0),
      total: relevant.reduce((s, p) => s + p.total, 0),
    };
  }

  private updateBudget(slo: SLOTarget): void {
    const budget = this.calculateErrorBudget(slo.name);
    if (!budget) return;
    this.budgetHistory.get(slo.name)!.push({
      timestamp: Date.now(),
      consumed: budget.consumed,
    });
    // 限制历史
    const hist = this.budgetHistory.get(slo.name)!;
    if (hist.length > 1000) {
      hist.shift();
    }
    this.emit({
      type: 'budget-updated',
      timestamp: Date.now(),
      sloName: slo.name,
      consumed: budget.consumed,
      total: budget.total,
    });
  }

  private classifyBurnRate(burnRate: number, target: number): SLOReport['burnRateAlert'] {
    if (burnRate < 0.5) return 'none';
    if (burnRate < 1.0) return 'low';
    if (burnRate < 2.0) return 'medium';
    if (burnRate < 5.0) return 'high';
    return 'critical';
  }

  private calculateTrend(sliId: string): SLOReport['trend'] {
    const points = this.dataPoints.get(sliId) ?? [];
    if (points.length < 2) return 'stable';
    const halfIdx = Math.floor(points.length / 2);
    const first = points.slice(0, halfIdx);
    const second = points.slice(halfIdx);
    const firstAvg = first.reduce((s, p) => s + (p.total > 0 ? p.good / p.total : 0), 0) / first.length;
    const secondAvg = second.reduce((s, p) => s + (p.total > 0 ? p.good / p.total : 0), 0) / second.length;
    const diff = secondAvg - firstAvg;
    if (Math.abs(diff) < 0.001) return 'stable';
    return diff > 0 ? 'improving' : 'degrading';
  }

  private slios(name: string): SLOTarget | null {
    return this.slos.get(name) ?? null;
  }

  private emit(event: SLOEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 忽略错误
      }
    }
  }
}

// ============================================================
// 预制 SLI 模板
// ====================================

/** 创建 HTTP 可用性 SLI */
export function createAvailabilitySLI(service: string): SLIDefinition {
  return createSLI({
    name: 'http-availability',
    type: 'availability',
    description: 'HTTP 请求成功率 (非 5xx)',
    goodQuery: `sum(rate(http_requests_total{service="${service}",status!~"5.."}[5m]))`,
    totalQuery: `sum(rate(http_requests_total{service="${service}"}[5m]))`,
    unit: 'ratio',
  });
}

/** 创建 HTTP 延迟 SLI (P95 < 500ms) */
export function createLatencySLI(service: string, thresholdMs: number = 500): SLIDefinition {
  return createSLI({
    name: `http-latency-p95-${thresholdMs}ms`,
    type: 'latency',
    description: `P95 延迟 < ${thresholdMs}ms 的请求比例`,
    goodQuery: `sum(rate(http_request_duration_seconds_bucket{service="${service}",le="${thresholdMs / 1000}"}[5m]))`,
    totalQuery: `sum(rate(http_request_duration_seconds_count{service="${service}"}[5m]))`,
    unit: 'ratio',
  });
}
