/**
 * UsageAttributionEngine 单元测试 (v1.0.0 Cycle 28 G28-03)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { UsageAttributionEngine, getDefaultUsageAttributionEngine, ATTRIBUTION_SCHEMA_VERSION } from './usageAttributionEngine';

describe('UsageAttributionEngine', () => {
  let engine: UsageAttributionEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new UsageAttributionEngine();
  });

  describe('记录管理', () => {
    it('addRecord 完整字段', () => {
      const r = engine.addRecord({
        timestamp: Date.now(),
        agentPath: '/root/a',
        sessionId: 's1',
        modelId: 'gpt-5.3-codex',
        inputTokens: 1000,
        outputTokens: 2000,
        costUsd: 0.01,
      });
      expect(r.id).toBeDefined();
      expect(r.agentPath).toBe('/root/a');
    });

    it('listRecords 按 agentPath 过滤', () => {
      engine.addRecord({ timestamp: Date.now(), agentPath: '/root/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 });
      engine.addRecord({ timestamp: Date.now(), agentPath: '/root/b', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 });
      const result = engine.listRecords({ agentPath: '/root/a' });
      expect(result.every((r) => r.agentPath === '/root/a')).toBe(true);
    });

    it('listRecords 按时间过滤', () => {
      const now = Date.now();
      engine.addRecord({ timestamp: now - 10000, agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 });
      engine.addRecord({ timestamp: now, agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 });
      const result = engine.listRecords({ since: now - 5000 });
      expect(result.length).toBe(1);
    });
  });

  describe('报告生成', () => {
    it('基本结构', () => {
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's1', modelId: 'm', inputTokens: 100, outputTokens: 200, costUsd: 0.01 });
      const report = engine.generateReport();
      expect(report.schemaVersion).toBe(ATTRIBUTION_SCHEMA_VERSION);
      expect(report.summary.totalInputTokens).toBe(100);
      expect(report.summary.totalOutputTokens).toBe(200);
      expect(report.summary.totalCostUsd).toBe(0.01);
      expect(report.summary.recordCount).toBe(1);
    });

    it('byAgent 聚合', () => {
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 1 });
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 2 });
      engine.addRecord({ timestamp: Date.now(), agentPath: '/b', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 3 });
      const report = engine.generateReport();
      const aEntry = report.byAgent.find((e) => e.agentPath === '/a');
      const bEntry = report.byAgent.find((e) => e.agentPath === '/b');
      expect(aEntry?.costUsd).toBe(3);
      expect(bEntry?.costUsd).toBe(3);
    });

    it('byModel 聚合', () => {
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm1', inputTokens: 0, outputTokens: 0, costUsd: 1 });
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm2', inputTokens: 0, outputTokens: 0, costUsd: 2 });
      const report = engine.generateReport();
      expect(report.byModel.length).toBe(2);
    });

    it('byTask 聚合', () => {
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', taskId: 't1', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 1 });
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', taskId: 't2', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 2 });
      const report = engine.generateReport();
      expect(report.byTask.length).toBe(2);
    });

    it('exportJson 返回字符串', () => {
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 1 });
      const json = engine.exportJson();
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('项目标记', () => {
    it('tagProject 批量标记', () => {
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 });
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 });
      const count = engine.tagProject('/a', 'project-x');
      expect(count).toBe(2);
    });

    it('不覆盖已标记', () => {
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0, projectId: 'p1' });
      const count = engine.tagProject('/a', 'project-x');
      expect(count).toBe(0);
    });
  });

  describe('事件系统', () => {
    it('订阅 record-added', () => {
      const events: any[] = [];
      engine.on('record-added', (e) => events.push(e));
      engine.addRecord({ timestamp: Date.now(), agentPath: '/a', sessionId: 's', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: 0 });
      expect(events.length).toBe(1);
    });

    it('订阅 report-generated', () => {
      const events: any[] = [];
      engine.on('report-generated', (e) => events.push(e));
      engine.generateReport();
      expect(events.length).toBe(1);
    });
  });
});

describe('单例', () => {
  it('getDefault 返回相同实例', () => {
    const a = getDefaultUsageAttributionEngine();
    const b = getDefaultUsageAttributionEngine();
    expect(a).toBe(b);
  });
});
