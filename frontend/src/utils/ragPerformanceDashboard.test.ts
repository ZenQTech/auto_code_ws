/**
 * # ragPerformanceDashboard 单元测试 (v1.0.0 Cycle 47 G47-03)
 * # 测试维度:
 * #   1. 基础功能 (记录/查询/统计)
 * #   2. 时间窗口聚合 (P50/P95/P99)
 * #   3. 性能瓶颈分析
 * #   4. Provider 性能对比
 * #   5. 告警机制 (触发/恢复)
 * #   6. 数据导出 (JSON/CSV)
 * #   7. 事件订阅
 * #   8. 内存管理
 * #   9. 工厂函数
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  RAGPerformanceDashboard,
  createDefaultDashboard,
  type PerformanceMetric,
  type AlertRule,
  type AlertEvent,
  type MetricFilter,
  type RAGStage,
} from './ragPerformanceDashboard';

describe('RAGPerformanceDashboard - 基础功能', () => {
  let dashboard: RAGPerformanceDashboard;

  beforeEach(() => {
    dashboard = new RAGPerformanceDashboard({ maxMetrics: 100 });
  });

  it('应能创建仪表盘实例', () => {
    expect(dashboard).toBeDefined();
    const stats = dashboard.getStats();
    expect(stats.totalMetrics).toBe(0);
  });

  it('应能记录延迟指标', () => {
    const metric = dashboard.recordLatency('retrieval', 50);
    expect(metric.stage).toBe('retrieval');
    expect(metric.kind).toBe('latency');
    expect(metric.value).toBe(50);
    expect(dashboard.getStats().totalMetrics).toBe(1);
  });

  it('应能记录吞吐量指标', () => {
    const metric = dashboard.recordThroughput('total', 100);
    expect(metric.kind).toBe('throughput');
    expect(metric.value).toBe(100);
  });

  it('应能记录缓存命中率', () => {
    const metric = dashboard.recordCacheHitRate(0.85);
    expect(metric.kind).toBe('cache_hit_rate');
    expect(metric.value).toBe(0.85);
  });

  it('应能记录错误率', () => {
    const metric = dashboard.recordErrorRate('generation', 0.05);
    expect(metric.kind).toBe('error_rate');
  });

  it('应能记录成本', () => {
    const metric = dashboard.recordCost('generation', 0.002);
    expect(metric.kind).toBe('cost');
  });

  it('应能记录 Token 使用', () => {
    const metric = dashboard.recordTokens('generation', 1500);
    expect(metric.kind).toBe('tokens');
  });

  it('应能记录带标签的指标', () => {
    const metric = dashboard.recordLatency('generation', 250, { provider: 'openai', model: 'gpt-4' });
    expect(metric.labels?.provider).toBe('openai');
    expect(metric.labels?.model).toBe('gpt-4');
  });

  it('应能使用 record() 自定义指标', () => {
    const metric = dashboard.record({
      stage: 'cache',
      kind: 'memory_bytes',
      value: 1024,
    });
    expect(metric.kind).toBe('memory_bytes');
    expect(metric.value).toBe(1024);
  });

  it('应在超过 maxMetrics 时淘汰旧指标', () => {
    const small = new RAGPerformanceDashboard({ maxMetrics: 5 });
    for (let i = 0; i < 10; i++) {
      small.recordLatency('retrieval', i);
    }
    expect(small.getStats().totalMetrics).toBe(5);
  });

  it('应能查询所有指标', () => {
    for (let i = 0; i < 5; i++) {
      dashboard.recordLatency('retrieval', i * 10);
    }
    const all = dashboard.getMetrics();
    expect(all.length).toBe(5);
  });

  it('应能按时间过滤指标', () => {
    const now = Date.now();
    dashboard.recordLatency('retrieval', 10, undefined);
    const later = dashboard.getMetrics({ startTime: now - 1000 });
    expect(later.length).toBeGreaterThanOrEqual(1);
  });

  it('应能按阶段过滤指标', () => {
    dashboard.recordLatency('retrieval', 10);
    dashboard.recordLatency('generation', 20);
    const retrieval = dashboard.getMetrics({ stages: ['retrieval'] });
    expect(retrieval.every((m) => m.stage === 'retrieval')).toBe(true);
    expect(retrieval.length).toBe(1);
  });

  it('应能按指标类型过滤', () => {
    dashboard.recordLatency('retrieval', 10);
    dashboard.recordThroughput('total', 100);
    const latency = dashboard.getMetrics({ kinds: ['latency'] });
    expect(latency.every((m) => m.kind === 'latency')).toBe(true);
    expect(latency.length).toBe(1);
  });

  it('应能按标签过滤', () => {
    dashboard.recordLatency('retrieval', 10, { provider: 'openai' });
    dashboard.recordLatency('retrieval', 20, { provider: 'anthropic' });
    const openai = dashboard.getMetrics({ labels: { provider: 'openai' } });
    expect(openai.length).toBe(1);
    expect(openai[0]!.labels?.provider).toBe('openai');
  });

  it('应支持 limit 限制', () => {
    for (let i = 0; i < 10; i++) {
      dashboard.recordLatency('retrieval', i);
    }
    const limited = dashboard.getMetrics({ limit: 3 });
    expect(limited.length).toBe(3);
  });
});

describe('RAGPerformanceDashboard - 时间窗口聚合', () => {
  let dashboard: RAGPerformanceDashboard;

  beforeEach(() => {
    dashboard = new RAGPerformanceDashboard();
  });

  it('应能按分钟聚合', () => {
    for (let i = 0; i < 10; i++) {
      dashboard.recordLatency('retrieval', 10 + i);
    }
    const agg = dashboard.getAggregations('minute', { bucketCount: 5 });
    expect(agg.interval).toBe('minute');
    expect(agg.bucketSizeMs).toBe(60000);
    expect(agg.bucketCount).toBe(5);
    expect(agg.buckets.length).toBe(5);
  });

  it('应能按小时聚合', () => {
    const agg = dashboard.getAggregations('hour', { bucketCount: 3 });
    expect(agg.bucketSizeMs).toBe(3600000);
    expect(agg.bucketCount).toBe(3);
  });

  it('应能按天聚合', () => {
    const agg = dashboard.getAggregations('day', { bucketCount: 2 });
    expect(agg.bucketSizeMs).toBe(86400000);
    expect(agg.bucketCount).toBe(2);
  });

  it('聚合桶应包含完整的统计数据', () => {
    dashboard.recordLatency('retrieval', 10);
    dashboard.recordLatency('retrieval', 20);
    dashboard.recordLatency('retrieval', 30);
    const agg = dashboard.getAggregations('minute', { bucketCount: 1 });
    expect(agg.buckets.length).toBe(1);
    const bucket = agg.buckets[0]!;
    expect(bucket.count).toBe(3);
    expect(bucket.sum).toBe(60);
    expect(bucket.avg).toBe(20);
    expect(bucket.min).toBe(10);
    expect(bucket.max).toBe(30);
    expect(bucket.p50).toBe(20);
  });

  it('空桶应返回 0 值', () => {
    const agg = dashboard.getAggregations('minute', { bucketCount: 3 });
    expect(agg.buckets.every((b) => b.count === 0)).toBe(true);
    expect(agg.buckets.every((b) => b.avg === 0)).toBe(true);
  });

  it('应正确计算 P95 百分位数', () => {
    for (let i = 1; i <= 100; i++) {
      dashboard.recordLatency('retrieval', i);
    }
    const agg = dashboard.getAggregations('minute', { bucketCount: 1 });
    // 100 个值都在最后一分钟, 因为 recordLatency 使用 Date.now()
    const lastBucket = agg.buckets[agg.buckets.length - 1]!;
    expect(lastBucket.p95).toBeGreaterThan(90);
    expect(lastBucket.p95).toBeLessThan(100);
  });

  it('应支持自定义时间范围', () => {
    const now = Date.now();
    const startTime = now - 60000;
    const endTime = now + 60000;
    const agg = dashboard.getAggregations('minute', { startTime, endTime, bucketCount: 2 });
    expect(agg.startTime).toBe(startTime);
    expect(agg.endTime).toBe(endTime);
  });
});

describe('RAGPerformanceDashboard - 性能瓶颈分析', () => {
  let dashboard: RAGPerformanceDashboard;

  beforeEach(() => {
    dashboard = new RAGPerformanceDashboard();
  });

  it('空数据应返回合理默认值', () => {
    const report = dashboard.getBottleneckAnalysis();
    expect(report.totalQueries).toBe(0);
    expect(report.avgTotalLatencyMs).toBe(0);
    expect(report.p95TotalLatencyMs).toBe(0);
  });

  it('应识别检索为瓶颈', () => {
    for (let i = 0; i < 20; i++) {
      dashboard.recordLatency('retrieval', 600); // 高延迟
      dashboard.recordLatency('generation', 100);
      dashboard.recordLatency('total', 700);
    }
    const report = dashboard.getBottleneckAnalysis();
    expect(report.slowestStage).toBe('retrieval');
    expect(report.bottleneckReason).toContain('向量检索');
    expect(report.suggestions.length).toBeGreaterThan(0);
  });

  it('应识别生成为瓶颈', () => {
    for (let i = 0; i < 20; i++) {
      dashboard.recordLatency('retrieval', 100);
      dashboard.recordLatency('generation', 600); // 高延迟
      dashboard.recordLatency('total', 700);
    }
    const report = dashboard.getBottleneckAnalysis();
    expect(report.slowestStage).toBe('generation');
    expect(report.bottleneckReason).toContain('LLM');
  });

  it('应识别 embedding 为瓶颈', () => {
    for (let i = 0; i < 20; i++) {
      dashboard.recordLatency('embedding', 500);
      dashboard.recordLatency('retrieval', 100);
      dashboard.recordLatency('generation', 100);
      dashboard.recordLatency('total', 700);
    }
    const report = dashboard.getBottleneckAnalysis();
    expect(report.slowestStage).toBe('embedding');
  });

  it('应包含优化建议', () => {
    for (let i = 0; i < 10; i++) {
      dashboard.recordLatency('retrieval', 500);
      dashboard.recordLatency('total', 600);
    }
    const report = dashboard.getBottleneckAnalysis();
    expect(Array.isArray(report.suggestions)).toBe(true);
    expect(report.suggestions.length).toBeGreaterThan(0);
  });

  it('应计算各阶段延迟占比', () => {
    for (let i = 0; i < 10; i++) {
      dashboard.recordLatency('retrieval', 100);
      dashboard.recordLatency('generation', 300);
      dashboard.recordLatency('total', 400);
    }
    const report = dashboard.getBottleneckAnalysis();
    expect(report.stageLatencies.retrieval.share).toBeCloseTo(0.25, 1);
    expect(report.stageLatencies.generation.share).toBeCloseTo(0.75, 1);
  });

  it('应包含缓存命中率', () => {
    dashboard.recordCacheHitRate(0.65);
    const report = dashboard.getBottleneckAnalysis();
    expect(report.cacheHitRate).toBeCloseTo(0.65, 2);
  });

  it('应包含错误率', () => {
    dashboard.recordErrorRate('total', 0.05);
    const report = dashboard.getBottleneckAnalysis();
    expect(report.errorRate).toBeCloseTo(0.05, 2);
  });
});

describe('RAGPerformanceDashboard - Provider 性能对比', () => {
  let dashboard: RAGPerformanceDashboard;

  beforeEach(() => {
    dashboard = new RAGPerformanceDashboard();
  });

  it('空数据应返回空数组', () => {
    const comparison = dashboard.getProviderComparison();
    expect(comparison.length).toBe(0);
  });

  it('应按 Provider 分组', () => {
    dashboard.recordLatency('generation', 100, { provider: 'openai' });
    dashboard.recordLatency('generation', 200, { provider: 'openai' });
    dashboard.recordLatency('generation', 150, { provider: 'anthropic' });
    const comparison = dashboard.getProviderComparison();
    expect(comparison.length).toBe(2);
  });

  it('应按平均延迟排序', () => {
    dashboard.recordLatency('generation', 300, { provider: 'slow' });
    dashboard.recordLatency('generation', 100, { provider: 'fast' });
    const comparison = dashboard.getProviderComparison();
    expect(comparison[0]!.provider).toBe('fast');
    expect(comparison[1]!.provider).toBe('slow');
  });

  it('应计算错误率', () => {
    dashboard.recordLatency('generation', 100, { provider: 'openai', error: 'true' });
    dashboard.recordLatency('generation', 100, { provider: 'openai' });
    const comparison = dashboard.getProviderComparison();
    expect(comparison[0]!.errorRate).toBeCloseTo(0.5, 2);
  });

  it('应支持自定义时间窗口', () => {
    dashboard.recordLatency('generation', 100, { provider: 'openai' });
    const comparison = dashboard.getProviderComparison(60000);
    expect(comparison.length).toBe(1);
  });

  it('应包含 P95 延迟', () => {
    for (let i = 0; i < 20; i++) {
      dashboard.recordLatency('generation', i * 10, { provider: 'openai' });
    }
    const comparison = dashboard.getProviderComparison();
    expect(comparison[0]!.p95LatencyMs).toBeGreaterThan(0);
  });
});

describe('RAGPerformanceDashboard - 告警机制', () => {
  let dashboard: RAGPerformanceDashboard;
  let alertCallback: (alert: AlertEvent) => void;

  beforeEach(() => {
    alertCallback = vi.fn();
  });

  it('应在超过阈值时触发告警', () => {
    const rule: AlertRule = {
      id: 'test-rule',
      name: '测试告警',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      enabled: true,
      severity: 'warning',
    };
    dashboard = new RAGPerformanceDashboard({
      alertRules: [rule],
      onAlert: alertCallback,
    });
    dashboard.recordLatency('total', 200);
    const alerts = dashboard.getAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.ruleId).toBe('test-rule');
    expect(alerts[0]!.value).toBe(200);
    expect(alertCallback).toHaveBeenCalledTimes(1);
  });

  it('低于阈值不应触发告警', () => {
    const rule: AlertRule = {
      id: 'test-rule',
      name: '测试告警',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      enabled: true,
      severity: 'warning',
    };
    dashboard = new RAGPerformanceDashboard({ alertRules: [rule] });
    dashboard.recordLatency('total', 50);
    expect(dashboard.getAlerts().length).toBe(0);
  });

  it('应支持 < 比较 (低于阈值告警)', () => {
    const rule: AlertRule = {
      id: 'low-cache',
      name: '低缓存命中率',
      stage: 'cache',
      kind: 'cache_hit_rate',
      threshold: 0.5,
      comparison: 'lt',
      enabled: true,
      severity: 'info',
    };
    dashboard = new RAGPerformanceDashboard({ alertRules: [rule] });
    dashboard.recordCacheHitRate(0.3);
    expect(dashboard.getAlerts().length).toBe(1);
  });

  it('应支持持续时间 (durationMs)', () => {
    const rule: AlertRule = {
      id: 'test-rule',
      name: '测试告警',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      durationMs: 1000,
      enabled: true,
      severity: 'warning',
    };
    dashboard = new RAGPerformanceDashboard({ alertRules: [rule] });
    dashboard.recordLatency('total', 200);
    // 持续时间未到, 不应触发
    expect(dashboard.getAlerts().length).toBe(0);
  });

  it('禁用规则不应触发告警', () => {
    const rule: AlertRule = {
      id: 'test-rule',
      name: '测试告警',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      enabled: false,
      severity: 'warning',
    };
    dashboard = new RAGPerformanceDashboard({ alertRules: [rule] });
    dashboard.recordLatency('total', 200);
    expect(dashboard.getAlerts().length).toBe(0);
  });

  it('应能动态添加告警规则', () => {
    dashboard = new RAGPerformanceDashboard();
    dashboard.addAlertRule({
      id: 'new-rule',
      name: '新规则',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      enabled: true,
      severity: 'warning',
    });
    dashboard.recordLatency('total', 200);
    expect(dashboard.getAlerts().length).toBe(1);
  });

  it('应能移除告警规则', () => {
    dashboard = new RAGPerformanceDashboard();
    dashboard.addAlertRule({
      id: 'new-rule',
      name: '新规则',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      enabled: true,
      severity: 'warning',
    });
    expect(dashboard.removeAlertRule('new-rule')).toBe(true);
    dashboard.recordLatency('total', 200);
    expect(dashboard.getAlerts().length).toBe(0);
  });

  it('应按严重级别过滤告警', () => {
    const rules: AlertRule[] = [
      {
        id: 'r1',
        name: '警告',
        stage: 'total',
        kind: 'latency',
        threshold: 100,
        comparison: 'gt',
        enabled: true,
        severity: 'warning',
      },
      {
        id: 'r2',
        name: '严重',
        stage: 'total',
        kind: 'latency',
        threshold: 200,
        comparison: 'gt',
        enabled: true,
        severity: 'critical',
      },
    ];
    dashboard = new RAGPerformanceDashboard({ alertRules: rules });
    dashboard.recordLatency('total', 500);
    const critical = dashboard.getAlerts({ severity: 'critical' });
    expect(critical.every((a) => a.severity === 'critical')).toBe(true);
  });

  it('阈值恢复后应清除告警', () => {
    const rule: AlertRule = {
      id: 'test-rule',
      name: '测试告警',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      enabled: true,
      severity: 'warning',
    };
    dashboard = new RAGPerformanceDashboard({ alertRules: [rule] });
    dashboard.recordLatency('total', 200);
    expect(dashboard.getAlerts({ activeOnly: true }).length).toBe(1);
    dashboard.recordLatency('total', 50);
    expect(dashboard.getAlerts({ activeOnly: true }).length).toBe(0);
  });

  it('应能告警回调静默失败', () => {
    const rule: AlertRule = {
      id: 'test-rule',
      name: '测试告警',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      enabled: true,
      severity: 'warning',
    };
    const brokenCallback = () => {
      throw new Error('回调错误');
    };
    dashboard = new RAGPerformanceDashboard({
      alertRules: [rule],
      onAlert: brokenCallback,
    });
    expect(() => dashboard.recordLatency('total', 200)).not.toThrow();
  });
});

describe('RAGPerformanceDashboard - 数据导出', () => {
  let dashboard: RAGPerformanceDashboard;

  beforeEach(() => {
    dashboard = new RAGPerformanceDashboard();
  });

  it('应能导出为 JSON', () => {
    dashboard.recordLatency('retrieval', 50);
    const json = dashboard.exportDashboard('json');
    expect(json).toContain('"stage": "retrieval"');
    expect(json).toContain('"value": 50');
  });

  it('JSON 导出应包含统计信息', () => {
    dashboard.recordLatency('retrieval', 50);
    const json = dashboard.exportDashboard('json');
    const parsed = JSON.parse(json);
    expect(parsed.stats).toBeDefined();
    expect(parsed.metrics).toBeDefined();
    expect(parsed.alerts).toBeDefined();
  });

  it('应能导出为 CSV', () => {
    dashboard.recordLatency('retrieval', 50);
    dashboard.recordLatency('generation', 100);
    const csv = dashboard.exportDashboard('csv');
    const lines = csv.split('\n');
    expect(lines[0]).toContain('id,timestamp,stage,kind,value');
    expect(lines.length).toBe(3);
  });

  it('CSV 应正确转义标签', () => {
    dashboard.recordLatency('retrieval', 50, { provider: 'openai,inc' });
    const csv = dashboard.exportDashboard('csv');
    expect(csv).toContain('"');
  });
});

describe('RAGPerformanceDashboard - 事件订阅', () => {
  let dashboard: RAGPerformanceDashboard;

  beforeEach(() => {
    dashboard = new RAGPerformanceDashboard();
  });

  it('应能订阅事件', () => {
    const listener = vi.fn();
    dashboard.subscribe(listener);
    dashboard.recordLatency('retrieval', 50);
    expect(listener).toHaveBeenCalled();
  });

  it('应能取消订阅', () => {
    const listener = vi.fn();
    const unsubscribe = dashboard.subscribe(listener);
    unsubscribe();
    dashboard.recordLatency('retrieval', 50);
    expect(listener).not.toHaveBeenCalled();
  });

  it('事件应包含指标信息', () => {
    const listener = vi.fn();
    dashboard.subscribe(listener);
    dashboard.recordLatency('retrieval', 50);
    const event = listener.mock.calls[0]![0];
    expect(event.type).toBe('metric-recorded');
  });

  it('应触发淘汰事件', () => {
    const listener = vi.fn();
    const small = new RAGPerformanceDashboard({ maxMetrics: 2 });
    small.subscribe(listener);
    for (let i = 0; i < 5; i++) {
      small.recordLatency('retrieval', i);
    }
    const evicted = listener.mock.calls.filter((c) => c[0].type === 'metric-evicted');
    expect(evicted.length).toBeGreaterThan(0);
  });

  it('应触发清空事件', () => {
    const listener = vi.fn();
    dashboard.subscribe(listener);
    dashboard.clear();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'cleared' }));
  });

  it('listener 异常应被静默处理', () => {
    const brokenListener = () => {
      throw new Error('listener error');
    };
    dashboard.subscribe(brokenListener);
    expect(() => dashboard.recordLatency('retrieval', 50)).not.toThrow();
  });
});

describe('RAGPerformanceDashboard - 内存管理', () => {
  it('clear() 应清空所有数据', () => {
    const dashboard = new RAGPerformanceDashboard();
    dashboard.recordLatency('retrieval', 50);
    dashboard.recordLatency('generation', 100);
    const rule: AlertRule = {
      id: 'r1',
      name: 'r',
      stage: 'total',
      kind: 'latency',
      threshold: 100,
      comparison: 'gt',
      enabled: true,
      severity: 'warning',
    };
    dashboard.addAlertRule(rule);
    dashboard.recordLatency('total', 200);
    expect(dashboard.getStats().totalMetrics).toBe(3);

    dashboard.clear();
    expect(dashboard.getStats().totalMetrics).toBe(0);
    expect(dashboard.getStats().totalAlerts).toBe(0);
    expect(dashboard.getStats().activeAlerts).toBe(0);
  });
});

describe('RAGPerformanceDashboard - 工厂函数', () => {
  it('createDefaultDashboard 应返回带默认规则的仪表盘', () => {
    const dashboard = createDefaultDashboard();
    expect(dashboard).toBeDefined();
    // 默认规则应触发告警
    dashboard.recordLatency('total', 5000);
    const alerts = dashboard.getAlerts();
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('createDefaultDashboard 应支持自定义配置', () => {
    const dashboard = createDefaultDashboard({ maxMetrics: 50 });
    for (let i = 0; i < 100; i++) {
      dashboard.recordLatency('retrieval', i);
    }
    expect(dashboard.getStats().totalMetrics).toBe(50);
  });

  it('createDefaultDashboard 应包含 4 个默认告警规则', () => {
    const dashboard = createDefaultDashboard();
    dashboard.recordLatency('total', 5000); // 触发 P95 latency critical
    dashboard.recordErrorRate('total', 0.5); // 触发 error rate high
    dashboard.recordCacheHitRate(0.1); // 触发 cache hit low
    const alerts = dashboard.getAlerts();
    expect(alerts.length).toBeGreaterThanOrEqual(3);
  });
});

describe('RAGPerformanceDashboard - 边界情况', () => {
  it('空指标查询应返回空数组', () => {
    const dashboard = new RAGPerformanceDashboard();
    expect(dashboard.getMetrics()).toEqual([]);
  });

  it('空聚合应返回空桶', () => {
    const dashboard = new RAGPerformanceDashboard();
    const agg = dashboard.getAggregations('minute', { bucketCount: 3 });
    expect(agg.buckets.length).toBe(3);
    expect(agg.buckets.every((b) => b.count === 0)).toBe(true);
  });

  it('应处理不存在的过滤器', () => {
    const dashboard = new RAGPerformanceDashboard();
    dashboard.recordLatency('retrieval', 50);
    const result = dashboard.getMetrics({ labels: { provider: 'nonexistent' } });
    expect(result.length).toBe(0);
  });

  it('应处理特殊时间范围', () => {
    const dashboard = new RAGPerformanceDashboard();
    dashboard.recordLatency('retrieval', 50);
    const result = dashboard.getMetrics({ startTime: 0, endTime: 1 });
    expect(result.length).toBe(0);
  });

  it('大量指标写入应保持正确性', () => {
    const dashboard = new RAGPerformanceDashboard({ maxMetrics: 1000 });
    for (let i = 0; i < 5000; i++) {
      dashboard.recordLatency('retrieval', i);
    }
    expect(dashboard.getStats().totalMetrics).toBe(1000);
  });

  it('所有 RAGStage 类型都应被支持', () => {
    const dashboard = new RAGPerformanceDashboard();
    const stages: RAGStage[] = ['retrieval', 'rerank', 'generation', 'embedding', 'cache', 'total'];
    for (const stage of stages) {
      dashboard.recordLatency(stage, 50);
    }
    const all = dashboard.getMetrics();
    expect(all.length).toBe(6);
  });
});
