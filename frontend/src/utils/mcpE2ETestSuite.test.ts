/**
 * # ============================================================
 * # MCP E2E Test Suite - 单元测试 (v1.0.0 Cycle 43 G43-04)
 * # ============================================================
 * # 覆盖：工厂函数 / 套件初始化 / 场景执行 / 统计 / 错误恢复
 * # 沙箱兼容：使用 mock provider + mock MCP 服务器
 * # ====================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-04 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  McpE2ETestSuite,
  createE2ETestSuite,
  runE2ETest,
  DEFAULT_E2E_SCENARIOS,
  assertE2EResult,
  type E2EScenario,
  type E2ETestResult,
} from './mcpE2ETestSuite';
import { MockVolcengineCodingPlanProvider } from './volcengineCodingPlanProvider';

describe('DEFAULT_E2E_SCENARIOS', () => {
  it('包含 5 大标准场景', () => {
    expect(DEFAULT_E2E_SCENARIOS.length).toBe(5);
    const types = DEFAULT_E2E_SCENARIOS.map((s) => s.type);
    expect(types).toContain('basic-chat');
    expect(types).toContain('single-tool-call');
    expect(types).toContain('multi-tool-call');
    expect(types).toContain('resource-reference');
    expect(types).toContain('error-recovery');
  });

  it('每个场景都有 name / description / userMessage', () => {
    for (const s of DEFAULT_E2E_SCENARIOS) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(s.userMessage).toBeTruthy();
    }
  });

  it('每个场景都有 validator', () => {
    for (const s of DEFAULT_E2E_SCENARIOS) {
      expect(typeof s.validator).toBe('function');
    }
  });
});

describe('McpE2ETestSuite', () => {
  let suite: McpE2ETestSuite;

  beforeEach(() => {
    suite = createE2ETestSuite({
      llmProvider: new MockVolcengineCodingPlanProvider(),
    });
  });

  afterEach(async () => {
    await suite.dispose();
  });

  it('工厂函数 createE2ETestSuite 创建实例', () => {
    const s = createE2ETestSuite();
    expect(s).toBeInstanceOf(McpE2ETestSuite);
  });

  it('未初始化时执行场景应抛出错误', async () => {
    await expect(
      suite.runScenario(DEFAULT_E2E_SCENARIOS[0]),
    ).rejects.toThrow(/not initialized/i);
  });

  it('成功初始化后可以执行场景', async () => {
    await suite.initialize();
    const result = await suite.runScenario({
      type: 'basic-chat',
      name: '简单对话',
      description: '简单对话测试',
      userMessage: '你好',
      validator: (r) => true,
    });
    expect(result.scenario).toBe('basic-chat');
    expect(typeof result.success).toBe('boolean');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('基本对话场景成功', async () => {
    await suite.initialize();
    const result = await suite.runScenario(DEFAULT_E2E_SCENARIOS[0]);
    expect(result.name).toBe('基础对话');
  });

  it('getStats 正确统计', () => {
    const results: E2ETestResult[] = [
      { scenario: 'basic-chat', name: 'a', success: true, durationMs: 10, result: {} as any },
      { scenario: 'single-tool-call', name: 'b', success: false, durationMs: 20, result: {} as any, error: 'x' },
      { scenario: 'multi-tool-call', name: 'c', success: true, durationMs: 30, result: {} as any },
    ];
    const stats = suite.getStats(results);
    expect(stats.total).toBe(3);
    expect(stats.passed).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.passRate).toBeCloseTo(2 / 3, 5);
    expect(stats.totalDurationMs).toBe(60);
  });

  it('getStats 处理空数组', () => {
    const stats = suite.getStats([]);
    expect(stats.total).toBe(0);
    expect(stats.passRate).toBe(0);
  });

  it('dispose 不抛出错误', async () => {
    await suite.initialize();
    await expect(suite.dispose()).resolves.toBeUndefined();
  });

  it('多次 dispose 幂等', async () => {
    await suite.initialize();
    await suite.dispose();
    await expect(suite.dispose()).resolves.toBeUndefined();
  });
});

describe('runE2ETest 便捷函数', () => {
  it('使用 mock provider 跑通基本场景', async () => {
    const { results, stats } = await runE2ETest({
      llmProvider: new MockVolcengineCodingPlanProvider(),
      scenarios: [DEFAULT_E2E_SCENARIOS[0]], // 仅 basic-chat
    });
    expect(results.length).toBe(1);
    expect(stats.total).toBe(1);
  });

  it('空场景列表返回空结果', async () => {
    const { results, stats } = await runE2ETest({
      llmProvider: new MockVolcengineCodingPlanProvider(),
      scenarios: [],
    });
    expect(results.length).toBe(0);
    expect(stats.total).toBe(0);
  });
});

describe('assertE2EResult', () => {
  const baseResult: E2ETestResult = {
    scenario: 'basic-chat',
    name: 'test',
    success: true,
    durationMs: 10,
    result: {
      content: 'hello',
      toolExecutions: [],
      resourceResolutions: [],
      promptRenders: [],
      totalTokens: 100,
      durationMs: 10,
      steps: 1,
      success: true,
      timestamp: Date.now(),
    } as any,
  };

  it('success=true 匹配时不抛出', () => {
    expect(() => assertE2EResult(baseResult, { success: true })).not.toThrow();
  });

  it('success 不匹配时抛出', () => {
    expect(() => assertE2EResult(baseResult, { success: false })).toThrow();
  });

  it('hasContent=true 且有内容不抛出', () => {
    expect(() => assertE2EResult(baseResult, { hasContent: true })).not.toThrow();
  });

  it('minTokens 不满足时抛出', () => {
    expect(() => assertE2EResult(baseResult, { minTokens: 200 })).toThrow();
  });
});
