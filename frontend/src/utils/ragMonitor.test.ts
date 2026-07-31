/**
 * # RAGMonitor 单元测试 (v1.0.0 Cycle 46 G46-02)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RAGMonitor, type RAGQueryRecord, type AlertEvent } from './ragMonitor';

function makeRecord(overrides: Partial<RAGQueryRecord> = {}): Omit<RAGQueryRecord, 'id' | 'timestamp'> {
  return {
    query: 'test query',
    hitCount: 3,
    topK: 5,
    success: true,
    provider: 'volcengine-ark',
    tokens: { input: 100, output: 200, total: 300 },
    cost: 0.001,
    latency: { retrievalMs: 50, llmMs: 200, totalMs: 250 },
    citationCount: 3,
    ...overrides,
  };
}

describe('RAGMonitor', () => {
  describe('构造与配置', () => {
    it('应该创建默认配置的实例', () => {
      const m = new RAGMonitor();
      expect(m).toBeDefined();
    });

    it('应该使用自定义配置', () => {
      const m = new RAGMonitor({
        maxHistory: 100,
        windowSizeMs: 10000,
        thresholds: { maxLatencyMs: 1000 },
      });
      expect(m).toBeDefined();
    });
  });

  describe('记录管理', () => {
    it('应该成功记录查询', () => {
      const m = new RAGMonitor();
      const r = m.record(makeRecord());
      expect(r.id).toBeDefined();
      expect(r.timestamp).toBeGreaterThan(0);
    });

    it('应该在达到 maxHistory 时淘汰最旧', () => {
      const m = new RAGMonitor({ maxHistory: 3 });
      m.record(makeRecord({ query: 'q1' }));
      m.record(makeRecord({ query: 'q2' }));
      m.record(makeRecord({ query: 'q3' }));
      m.record(makeRecord({ query: 'q4' }));
      const hist = m.getHistory();
      expect(hist.length).toBe(3);
      expect(hist[0].query).toBe('q2');
    });

    it('应该支持按时间过滤', () => {
      const m = new RAGMonitor();
      m.record(makeRecord());
      m.record(makeRecord());
      // sinceMs 是起始时间戳 - 返回该时间戳之后的记录
      // 查询 1 小时前的记录 - 应返回 2 条
      const oneHourAgo = Date.now() - 3600_000;
      const filtered = m.getHistory(undefined, oneHourAgo);
      expect(filtered.length).toBe(2);
      // 查询未来 - 应返回 0 条
      const future = Date.now() + 3600_000;
      const noneRecent = m.getHistory(undefined, future);
      expect(noneRecent.length).toBe(0);
    });

    it('应该支持按数量限制', () => {
      const m = new RAGMonitor();
      for (let i = 0; i < 5; i++) m.record(makeRecord());
      const last3 = m.getHistory(3);
      expect(last3.length).toBe(3);
    });

    it('应该支持清空历史', () => {
      const m = new RAGMonitor();
      m.record(makeRecord());
      m.clearHistory();
      expect(m.getHistory().length).toBe(0);
    });
  });

  describe('质量评估', () => {
    it('应该记录质量评估', () => {
      const m = new RAGMonitor();
      const r = m.record(makeRecord());
      m.assessQuality(r.id, {
        topKAccuracy: 0.8,
        hasRelevant: true,
        bestScore: 0.95,
        avgScore: 0.75,
        citationAccuracy: 0.9,
      });
      const a = m.getQualityAssessment(r.id);
      expect(a).toBeDefined();
      expect(a?.topKAccuracy).toBe(0.8);
    });
  });

  describe('告警系统', () => {
    it('应该在延迟超标时告警', () => {
      const m = new RAGMonitor({ thresholds: { maxLatencyMs: 100 } });
      let receivedAlert: AlertEvent | undefined;
      m.on((e) => {
        if (e.type === 'alert') receivedAlert = e.alert;
      });
      m.record(makeRecord({ latency: { retrievalMs: 50, llmMs: 200, totalMs: 500 } }));
      expect(receivedAlert).toBeDefined();
      expect(receivedAlert?.type).toBe('latency');
    });

    it('应该在命中率为 0 时告警', () => {
      const m = new RAGMonitor({ thresholds: { minHitRate: 0.5 } });
      let receivedAlert: AlertEvent | undefined;
      m.on((e) => {
        if (e.type === 'alert') receivedAlert = e.alert;
      });
      m.record(makeRecord({ hitCount: 0, topK: 5 }));
      expect(receivedAlert).toBeDefined();
    });

    it('应该在成本超标时告警', () => {
      const m = new RAGMonitor({ thresholds: { maxCostPerQuery: 0.01 } });
      let receivedAlert: AlertEvent | undefined;
      m.on((e) => {
        if (e.type === 'alert') receivedAlert = e.alert;
      });
      m.record(makeRecord({ cost: 0.1 }));
      expect(receivedAlert).toBeDefined();
      expect(receivedAlert?.type).toBe('cost');
    });

    it('应该按严重程度过滤告警', () => {
      const m = new RAGMonitor({ thresholds: { maxLatencyMs: 100 } });
      // 1000ms 超过阈值（warning），600ms 也超过（warning）
      m.record(makeRecord({ latency: { retrievalMs: 50, llmMs: 950, totalMs: 1000 } }));
      m.record(makeRecord({ latency: { retrievalMs: 50, llmMs: 550, totalMs: 600 } }));
      m.record(makeRecord({ latency: { retrievalMs: 50, llmMs: 200, totalMs: 200 } }));
      const warnings = m.getAlerts(undefined, 'warning');
      expect(warnings.length).toBeGreaterThan(0);
    });
  });

  describe('聚合分析', () => {
    it('应该返回完整统计', () => {
      const m = new RAGMonitor();
      m.record(makeRecord());
      m.record(makeRecord({ success: false }));
      m.record(makeRecord());
      const stats = m.getStats();
      expect(stats.totalRecords).toBe(3);
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(1);
      expect(stats.errorRate).toBeCloseTo(1 / 3);
    });

    it('应该按 Provider 聚合', () => {
      const m = new RAGMonitor();
      m.record(makeRecord({ provider: 'volcengine-ark' }));
      m.record(makeRecord({ provider: 'volcengine-ark' }));
      m.record(makeRecord({ provider: 'deepseek' }));
      const stats = m.getStats();
      expect(stats.byProvider['volcengine-ark'].count).toBe(2);
      expect(stats.byProvider['deepseek'].count).toBe(1);
    });

    it('应该按小时聚合', () => {
      const m = new RAGMonitor();
      m.record(makeRecord());
      m.record(makeRecord());
      const stats = m.getStats();
      expect(stats.byHour.length).toBeGreaterThan(0);
    });

    it('应该计算 P50/P95/P99 延迟', () => {
      const m = new RAGMonitor();
      for (let i = 0; i < 100; i++) {
        m.record(makeRecord({ latency: { retrievalMs: 10, llmMs: i, totalMs: i + 10 } }));
      }
      const stats = m.getStats();
      expect(stats.p50LatencyMs).toBeGreaterThan(0);
      expect(stats.p95LatencyMs).toBeGreaterThan(stats.p50LatencyMs);
      expect(stats.p99LatencyMs).toBeGreaterThanOrEqual(stats.p95LatencyMs);
    });

    it('应该支持窗口聚合', () => {
      const m = new RAGMonitor({ windowSizeMs: 1000 });
      m.record(makeRecord());
      m.record(makeRecord());
      const agg = m.getWindowAggregation();
      expect(agg.queryCount).toBe(2);
    });

    it('应该支持空历史聚合', () => {
      const m = new RAGMonitor();
      const stats = m.getStats();
      expect(stats.totalRecords).toBe(0);
      const agg = m.getWindowAggregation();
      expect(agg.queryCount).toBe(0);
    });
  });

  describe('导出', () => {
    it('应该导出 JSON 格式', () => {
      const m = new RAGMonitor();
      m.record(makeRecord());
      const json = m.exportHistory();
      expect(typeof json).toBe('string');
      const parsed = JSON.parse(json);
      expect(parsed.records.length).toBe(1);
    });
  });

  describe('趋势分析', () => {
    it('应该返回最近 N 条的趋势', () => {
      const m = new RAGMonitor();
      for (let i = 0; i < 10; i++) {
        m.record(makeRecord({ success: i % 2 === 0 }));
      }
      const trend = m.getRecentTrend(5);
      expect(trend.successRate).toBeGreaterThan(0);
      expect(trend.avgLatency).toBeGreaterThan(0);
    });

    it('应该处理空历史', () => {
      const m = new RAGMonitor();
      const trend = m.getRecentTrend();
      expect(trend.successRate).toBe(0);
    });
  });

  describe('事件订阅', () => {
    it('应该发出 record-added 事件', () => {
      const m = new RAGMonitor();
      let received = false;
      m.on((e) => {
        if (e.type === 'record-added') received = true;
      });
      m.record(makeRecord());
      expect(received).toBe(true);
    });

    it('应该支持退订', () => {
      const m = new RAGMonitor();
      const unsub = m.on(() => {});
      unsub();
      expect(typeof unsub).toBe('function');
    });

    it('应该在清空时发出 history-cleared 事件', () => {
      const m = new RAGMonitor();
      m.record(makeRecord());
      let clearedCount = 0;
      m.on((e) => {
        if (e.type === 'history-cleared') clearedCount = e.clearedCount;
      });
      m.clearHistory();
      expect(clearedCount).toBe(1);
    });
  });
});
