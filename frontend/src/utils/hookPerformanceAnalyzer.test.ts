/**
 * # ============================================================
 * # HookPerformanceAnalyzer 单元测试 (Cycle 22 G22-03)
 * # ============================================================
 * # 测试 HookPerformanceAnalyzer 所有公开方法和边界条件
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  HookPerformanceAnalyzer,
  getHookPerformanceAnalyzer,
  resetHookPerformanceAnalyzer,
  type HookExecutionRecord,
} from './hookPerformanceAnalyzer';

beforeEach(() => {
  resetHookPerformanceAnalyzer();
});

afterEach(() => {
  resetHookPerformanceAnalyzer();
});

/**
 * 生成测试执行记录
 */
function makeRecord(
  hookId: string,
  hookName: string,
  durationMs: number,
  status: 'success' | 'failed' | 'timeout' = 'success',
  chainId: string = 'chain-1'
): HookExecutionRecord {
  return {
    executionId: `${hookId}-${Math.random().toString(36).slice(2, 8)}`,
    chainId,
    hookId,
    hookName,
    hookType: 'test_type',
    durationMs,
    status,
    timestamp: Date.now(),
    error: status === 'failed' ? 'Test error' : undefined,
  };
}

describe('HookPerformanceAnalyzer - 基础配置', () => {
  it('应能创建实例', () => {
    const analyzer = new HookPerformanceAnalyzer();
    expect(analyzer).toBeDefined();
    expect(analyzer.getStats().recordCount).toBe(0);
  });

  it('应能使用自定义配置', () => {
    const analyzer = new HookPerformanceAnalyzer({
      slowMultiplier: 3,
      slowThresholdMs: 50,
      topSlowNodes: 5,
    });
    const config = analyzer.getConfig();
    expect(config.slowMultiplier).toBe(3);
    expect(config.slowThresholdMs).toBe(50);
    expect(config.topSlowNodes).toBe(5);
  });

  it('应能更新配置', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.updateConfig({ slowMultiplier: 4 });
    expect(analyzer.getConfig().slowMultiplier).toBe(4);
  });
});

describe('HookPerformanceAnalyzer - 数据摄入', () => {
  it('应能摄入单条记录', () => {
    const analyzer = new HookPerformanceAnalyzer();
    const record = makeRecord('hook-1', 'hook-one', 100);
    analyzer.ingestRecord(record);
    expect(analyzer.getRecords().length).toBe(1);
  });

  it('无效记录应抛出', () => {
    const analyzer = new HookPerformanceAnalyzer();
    expect(() => analyzer.ingestRecord({ ...makeRecord('hook-1', 'h', 100), executionId: '' })).toThrow();
  });

  it('应能批量摄入', () => {
    const analyzer = new HookPerformanceAnalyzer();
    const records = [
      makeRecord('hook-1', 'h1', 100),
      makeRecord('hook-2', 'h2', 200),
      makeRecord('hook-3', 'h3', 300),
    ];
    const ingested = analyzer.ingestRecords(records);
    expect(ingested).toBe(3);
    expect(analyzer.getRecords().length).toBe(3);
  });

  it('非数组应抛出', () => {
    const analyzer = new HookPerformanceAnalyzer();
    // @ts-expect-error 测试错误类型
    expect(() => analyzer.ingestRecords(null)).toThrow();
  });

  it('超过 maxRecords 应 FIFO 裁剪', () => {
    const analyzer = new HookPerformanceAnalyzer({ maxRecords: 3 });
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    analyzer.ingestRecord(makeRecord('hook-2', 'h2', 200));
    analyzer.ingestRecord(makeRecord('hook-3', 'h3', 300));
    analyzer.ingestRecord(makeRecord('hook-4', 'h4', 400));
    const records = analyzer.getRecords();
    expect(records.length).toBe(3);
    expect(records[records.length - 1].hookId).toBe('hook-4');
  });
});

describe('HookPerformanceAnalyzer - 慢节点分析', () => {
  it('应能识别慢节点', () => {
    const analyzer = new HookPerformanceAnalyzer();
    // 多个普通节点（每个 hook 多次执行）
    for (let i = 0; i < 10; i++) {
      analyzer.ingestRecord(makeRecord('hook-fast', 'fast', 20));
    }
    // 几个显著慢节点（同一个 hook 多次执行）
    for (let i = 0; i < 10; i++) {
      analyzer.ingestRecord(makeRecord('hook-slow', 'slow', 2000));
    }
    const slow = analyzer.analyzeSlowNodes();
    expect(slow.length).toBeGreaterThan(0);
    expect(slow[0].hookId).toBe('hook-slow');
  });

  it('执行次数不足不应被分析', () => {
    const analyzer = new HookPerformanceAnalyzer({ minExecutionsForAnalysis: 10 });
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 500));
    const slow = analyzer.analyzeSlowNodes();
    expect(slow.length).toBe(0);
  });

  it('应按 slowdownFactor 降序排序', () => {
    const analyzer = new HookPerformanceAnalyzer();
    // 慢节点 1：500ms
    for (let i = 0; i < 5; i++) analyzer.ingestRecord(makeRecord('hook-slow1', 's1', 500));
    // 慢节点 2：1000ms
    for (let i = 0; i < 5; i++) analyzer.ingestRecord(makeRecord('hook-slow2', 's2', 1000));
    // 慢节点 3：300ms
    for (let i = 0; i < 5; i++) analyzer.ingestRecord(makeRecord('hook-slow3', 's3', 300));
    // 基础节点
    for (let i = 0; i < 10; i++) analyzer.ingestRecord(makeRecord('hook-base', 'base', 50));

    const slow = analyzer.analyzeSlowNodes();
    if (slow.length >= 2) {
      expect(slow[0].slowdownFactor).toBeGreaterThanOrEqual(slow[1].slowdownFactor);
    }
  });

  it('应限制 TOP N 数量', () => {
    const analyzer = new HookPerformanceAnalyzer({ topSlowNodes: 2 });
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        // 每个 hook 有不同 ID（i 不同时）以确保多个独立 hook
        analyzer.ingestRecord(makeRecord(`hook-${i}-${j}`, `h-${i}`, 500 + i * 100));
      }
    }
    const slow = analyzer.analyzeSlowNodes();
    // 限制为 2 个
    expect(slow.length).toBeLessThanOrEqual(2);
  });
});

describe('HookPerformanceAnalyzer - 失败率分析', () => {
  it('应能识别高失败率节点', () => {
    const analyzer = new HookPerformanceAnalyzer({ failureRateThreshold: 0.1 });
    for (let i = 0; i < 5; i++) {
      analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100, 'success'));
    }
    for (let i = 0; i < 5; i++) {
      analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100, 'failed'));
    }
    const reports = analyzer.analyzeFailureRate();
    expect(reports.length).toBe(1);
    expect(reports[0].failureRate).toBe(0.5);
  });

  it('应能识别超时节点', () => {
    const analyzer = new HookPerformanceAnalyzer({ failureRateThreshold: 0.1 });
    for (let i = 0; i < 8; i++) {
      analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100, 'success'));
    }
    for (let i = 0; i < 2; i++) {
      analyzer.ingestRecord(makeRecord('hook-1', 'h1', 1000, 'timeout'));
    }
    const reports = analyzer.analyzeFailureRate();
    expect(reports.length).toBe(1);
    expect(reports[0].timeoutRate).toBe(0.2);
  });

  it('执行次数不足不应被分析', () => {
    const analyzer = new HookPerformanceAnalyzer({ minExecutionsForAnalysis: 10 });
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100, 'failed'));
    const reports = analyzer.analyzeFailureRate();
    expect(reports.length).toBe(0);
  });

  it('应统计常见错误', () => {
    const analyzer = new HookPerformanceAnalyzer({ failureRateThreshold: 0.1 });
    for (let i = 0; i < 5; i++) analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100, 'success'));
    const errorRecord1 = { ...makeRecord('hook-1', 'h1', 100, 'failed'), error: 'Error A' };
    const errorRecord2 = { ...makeRecord('hook-1', 'h1', 100, 'failed'), error: 'Error B' };
    const errorRecord3 = { ...makeRecord('hook-1', 'h1', 100, 'failed'), error: 'Error A' };
    analyzer.ingestRecord(errorRecord1);
    analyzer.ingestRecord(errorRecord2);
    analyzer.ingestRecord(errorRecord3);
    analyzer.ingestRecord({ ...makeRecord('hook-1', 'h1', 100, 'failed'), error: 'Error A' });
    analyzer.ingestRecord({ ...makeRecord('hook-1', 'h1', 100, 'failed'), error: 'Error A' });
    const reports = analyzer.analyzeFailureRate();
    expect(reports.length).toBe(1);
    expect(reports[0].commonErrors.length).toBeGreaterThan(0);
  });
});

describe('HookPerformanceAnalyzer - 优化建议', () => {
  it('应能为慢节点生成建议', () => {
    const analyzer = new HookPerformanceAnalyzer();
    const slowNodes = [
      {
        hookId: 'h1',
        hookName: 'slow-hook',
        hookType: 'type1',
        averageDurationMs: 1000,
        medianDurationMs: 950,
        p95DurationMs: 1500,
        maxDurationMs: 2000,
        executionCount: 10,
        slowdownFactor: 10,
        severity: 'critical' as const,
        sampleExecutionIds: ['e1', 'e2'],
      },
    ];
    const failureReports: any[] = [];
    const suggestions = analyzer.generateOptimizations(slowNodes, failureReports);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].targetHookId).toBe('h1');
  });

  it('应为失败率生成建议', () => {
    const analyzer = new HookPerformanceAnalyzer();
    const failureReports = [
      {
        hookId: 'h1',
        hookName: 'failing-hook',
        hookType: 'type1',
        totalExecutions: 10,
        failedExecutions: 5,
        timeoutExecutions: 0,
        failureRate: 0.5,
        timeoutRate: 0,
        severity: 'critical' as const,
        commonErrors: [],
        sampleFailedExecutionIds: [],
      },
    ];
    const suggestions = analyzer.generateOptimizations([], failureReports);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((s) => s.type === 'retry')).toBe(true);
  });

  it('建议应按严重度排序', () => {
    const analyzer = new HookPerformanceAnalyzer();
    const slowNodes = [
      {
        hookId: 'h1',
        hookName: 'medium-slow',
        hookType: 'type1',
        averageDurationMs: 200,
        medianDurationMs: 200,
        p95DurationMs: 300,
        maxDurationMs: 400,
        executionCount: 10,
        slowdownFactor: 2,
        severity: 'medium' as const,
        sampleExecutionIds: [],
      },
    ];
    const failureReports = [
      {
        hookId: 'h2',
        hookName: 'critical-fail',
        hookType: 'type2',
        totalExecutions: 10,
        failedExecutions: 5,
        timeoutExecutions: 0,
        failureRate: 0.5,
        timeoutRate: 0,
        severity: 'critical' as const,
        commonErrors: [],
        sampleFailedExecutionIds: [],
      },
    ];
    const suggestions = analyzer.generateOptimizations(slowNodes, failureReports);
    if (suggestions.length >= 2) {
      // 严重度顺序 critical > high > medium > low > info
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      const firstOrder = order[suggestions[0].severity];
      const secondOrder = order[suggestions[1].severity];
      expect(firstOrder).toBeLessThanOrEqual(secondOrder);
    }
  });
});

describe('HookPerformanceAnalyzer - 报告生成', () => {
  it('应能生成完整报告', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.generateMockData(3, 3, 5);
    const report = analyzer.generateReport();
    expect(report.reportId).toBeDefined();
    expect(report.totalExecutions).toBeGreaterThan(0);
    expect(report.totalHooks).toBeGreaterThan(0);
    expect(report.averageDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('应能列出报告', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    analyzer.generateReport();
    analyzer.generateReport();
    const reports = analyzer.listReports();
    expect(reports.length).toBe(2);
  });

  it('应能通过 ID 获取报告', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    const report = analyzer.generateReport();
    const fetched = analyzer.getReport(report.reportId);
    expect(fetched).toEqual(report);
  });

  it('不存在的报告应返回 null', () => {
    const analyzer = new HookPerformanceAnalyzer();
    expect(analyzer.getReport('nonexistent')).toBeNull();
  });
});

describe('HookPerformanceAnalyzer - 报告导出', () => {
  it('应能导出 JSON 格式', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.generateMockData(2, 2, 3);
    const report = analyzer.generateReport();
    const json = analyzer.exportReport(report.reportId, { format: 'json' });
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.reportId).toBe(report.reportId);
  });

  it('应能导出 HTML 格式', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.generateMockData(2, 2, 3);
    const report = analyzer.generateReport();
    const html = analyzer.exportReport(report.reportId, { format: 'html' });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(report.reportId);
  });

  it('应能导出 Markdown 格式', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.generateMockData(2, 2, 3);
    const report = analyzer.generateReport();
    const md = analyzer.exportReport(report.reportId, { format: 'markdown' });
    expect(md).toContain('# Hook 性能分析报告');
    expect(md).toContain(report.reportId);
  });

  it('不存在的报告应抛出', () => {
    const analyzer = new HookPerformanceAnalyzer();
    expect(() => analyzer.exportReport('nonexistent', { format: 'json' })).toThrow();
  });

  it('不支持的格式应抛出', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    const report = analyzer.generateReport();
    // @ts-expect-error 测试错误格式
    expect(() => analyzer.exportReport(report.reportId, { format: 'xml' })).toThrow();
  });

  it('应支持 includeRawData 与 includeOptimizations 选项', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.generateMockData(2, 2, 3);
    const report = analyzer.generateReport();
    const json1 = analyzer.exportReport(report.reportId, { format: 'json', includeOptimizations: false });
    const parsed1 = JSON.parse(json1);
    expect(parsed1.suggestions).toBeUndefined();
    const json2 = analyzer.exportReport(report.reportId, { format: 'json', includeRawData: false });
    const parsed2 = JSON.parse(json2);
    expect(parsed2.slowNodes).toBeUndefined();
  });
});

describe('HookPerformanceAnalyzer - 建议管理', () => {
  it('应能标记建议为已应用', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.generateMockData(2, 2, 5);
    const report = analyzer.generateReport();
    if (report.suggestions.length > 0) {
      const success = analyzer.markSuggestionApplied(report.reportId, report.suggestions[0].suggestionId);
      expect(success).toBe(true);
      const updated = analyzer.getReport(report.reportId);
      expect(updated!.suggestions[0].applied).toBe(true);
    }
  });

  it('不存在的报告/建议应返回 false', () => {
    const analyzer = new HookPerformanceAnalyzer();
    expect(analyzer.markSuggestionApplied('nonexistent', 'sid')).toBe(false);
  });
});

describe('HookPerformanceAnalyzer - 数据查询', () => {
  it('应能按 hookId 过滤', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    analyzer.ingestRecord(makeRecord('hook-2', 'h2', 200));
    const filtered = analyzer.getRecords({ hookId: 'hook-1' });
    expect(filtered.length).toBe(1);
  });

  it('应能按状态过滤', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100, 'success'));
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100, 'failed'));
    const failed = analyzer.getRecords({ status: 'failed' });
    expect(failed.length).toBe(1);
  });

  it('应能按时间过滤', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    const sinceMs = Date.now() + 10000;
    const filtered = analyzer.getRecords({ sinceMs });
    expect(filtered.length).toBe(0);
  });
});

describe('HookPerformanceAnalyzer - 事件订阅', () => {
  it('应触发 record-ingested 事件', () => {
    const analyzer = new HookPerformanceAnalyzer();
    const handler = vi.fn();
    analyzer.on('record-ingested', handler);
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 report-generated 事件', () => {
    const analyzer = new HookPerformanceAnalyzer();
    const handler = vi.fn();
    analyzer.on('report-generated', handler);
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    analyzer.generateReport();
    expect(handler).toHaveBeenCalled();
  });
});

describe('HookPerformanceAnalyzer - 清理', () => {
  it('应能清空所有数据', () => {
    const analyzer = new HookPerformanceAnalyzer();
    analyzer.ingestRecord(makeRecord('hook-1', 'h1', 100));
    analyzer.generateReport();
    analyzer.clear();
    expect(analyzer.getStats().recordCount).toBe(0);
    expect(analyzer.getStats().reportCount).toBe(0);
  });
});

describe('HookPerformanceAnalyzer - 单例工厂', () => {
  it('getHookPerformanceAnalyzer 应返回单例', () => {
    const a1 = getHookPerformanceAnalyzer();
    const a2 = getHookPerformanceAnalyzer();
    expect(a1).toBe(a2);
  });

  it('resetHookPerformanceAnalyzer 应清空状态', () => {
    getHookPerformanceAnalyzer();
    resetHookPerformanceAnalyzer();
    const a = getHookPerformanceAnalyzer();
    expect(a.getStats().recordCount).toBe(0);
  });
});

describe('HookPerformanceAnalyzer - 模拟数据', () => {
  it('generateMockData 应生成并摄入', () => {
    const analyzer = new HookPerformanceAnalyzer();
    const records = analyzer.generateMockData(3, 4, 5);
    expect(records.length).toBe(60);
    expect(analyzer.getStats().recordCount).toBe(60);
  });
});
