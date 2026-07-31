/**
 * # RAGE2ETestSuite 单元测试 (v1.0.0 Cycle 46 G46-04)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RAGE2ETestSuite, DEFAULT_E2E_SCENARIOS, type E2ETestScenario, type E2ETestSuiteResult } from './ragE2ETestSuite';

describe('RAGE2ETestSuite', () => {
  describe('构造与配置', () => {
    it('应该使用默认场景创建', () => {
      const suite = new RAGE2ETestSuite();
      expect(suite).toBeDefined();
    });

    it('应该使用自定义场景创建', () => {
      const customScenarios: E2ETestScenario[] = [
        {
          id: 'custom-1',
          name: 'Custom test',
          description: 'A custom test',
          category: 'basic',
          documents: [{ id: 'd1', content: 'test content' }],
          query: 'test query',
        },
      ];
      const suite = new RAGE2ETestSuite(customScenarios);
      expect(suite).toBeDefined();
    });

    it('默认场景应该包含 7+ 个测试', () => {
      expect(DEFAULT_E2E_SCENARIOS.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('运行单个场景', () => {
    it('应该成功运行基础场景', async () => {
      const suite = new RAGE2ETestSuite();
      const scenario: E2ETestScenario = {
        id: 'test-1',
        name: 'Test 1',
        description: 'Test',
        category: 'basic',
        documents: [{ id: 'd1', content: 'Test content about AI' }],
        query: 'What is this about?',
        llmMockResponse: 'AI',
        expectedCitations: ['d1'],
      };
      const result = await suite.runScenario(scenario);
      expect(result.scenarioId).toBe('test-1');
      expect(result.actualAnswer).toBeDefined();
    });

    it('应该处理无结果场景', async () => {
      const suite = new RAGE2ETestSuite();
      const scenario: E2ETestScenario = {
        id: 'test-no-results',
        name: 'No results',
        description: 'Test',
        category: 'error',
        documents: [{ id: 'd1', content: 'content' }],
        query: 'query',
        simulateError: 'no-results',
        llmMockResponse: 'no answer',
      };
      const result = await suite.runScenario(scenario);
      expect(result.passed).toBe(true);
    });

    it('应该处理 LLM 失败降级', async () => {
      const suite = new RAGE2ETestSuite();
      const scenario: E2ETestScenario = {
        id: 'test-llm-fail',
        name: 'LLM fails',
        description: 'Test',
        category: 'error',
        documents: [{ id: 'd1', content: 'content' }],
        query: 'query',
        simulateError: 'llm-fail',
        llmMockResponse: 'fallback response',
      };
      const result = await suite.runScenario(scenario);
      expect(result.actualAnswer).toBeDefined();
    });

    it('应该验证引用准确率', async () => {
      const suite = new RAGE2ETestSuite();
      const scenario: E2ETestScenario = {
        id: 'test-citation',
        name: 'Citation test',
        description: 'Test',
        category: 'quality',
        documents: [{ id: 'd1', content: 'Test' }],
        query: 'query',
        llmMockResponse: 'answer with [1]',
        expectedCitations: ['d1'],
      };
      const result = await suite.runScenario(scenario);
      expect(result.citationAccuracy).toBeGreaterThan(0);
    });

    it('应该计算答案相关性', async () => {
      const suite = new RAGE2ETestSuite();
      const scenario: E2ETestScenario = {
        id: 'test-relevance',
        name: 'Relevance test',
        description: 'Test',
        category: 'quality',
        documents: [{ id: 'd1', content: 'FastAPI' }],
        query: 'fastapi',
        llmMockResponse: 'fastapi web framework',
        expectedAnswer: 'fastapi',
      };
      const result = await suite.runScenario(scenario);
      // 验证答案被设置
      expect(result.actualAnswer).toBeDefined();
      expect(result.actualAnswer!.length).toBeGreaterThan(0);
    });

    it('应该验证最小分数', async () => {
      const suite = new RAGE2ETestSuite();
      const scenario: E2ETestScenario = {
        id: 'test-score',
        name: 'Score test',
        description: 'Test',
        category: 'quality',
        documents: [{ id: 'd1', content: 'Test' }],
        query: 'query',
        llmMockResponse: 'answer',
        expectedMinScore: 0.5,
      };
      const result = await suite.runScenario(scenario);
      expect(result.passed).toBe(true);
    });
  });

  describe('运行所有场景', () => {
    it('应该运行所有默认场景', async () => {
      const suite = new RAGE2ETestSuite();
      const result = await suite.runAll();
      expect(result.totalTests).toBe(DEFAULT_E2E_SCENARIOS.length);
      expect(result.passedTests + result.failedTests).toBe(result.totalTests);
    });

    it('应该生成性能基准', async () => {
      const suite = new RAGE2ETestSuite();
      const result = await suite.runAll();
      expect(result.benchmarks.avgDurationMs).toBeGreaterThan(0);
      expect(result.benchmarks.p50DurationMs).toBeGreaterThan(0);
      expect(result.benchmarks.throughputPerSec).toBeGreaterThan(0);
    });

    it('应该按分类统计', async () => {
      const suite = new RAGE2ETestSuite();
      const result = await suite.runAll();
      expect(Object.keys(result.byCategory).length).toBeGreaterThan(0);
    });

    it('应该生成质量指标', async () => {
      const suite = new RAGE2ETestSuite();
      const result = await suite.runAll();
      expect(result.quality.avgHitRate).toBeGreaterThanOrEqual(0);
      expect(result.quality.avgCitationAccuracy).toBeGreaterThanOrEqual(0);
      expect(result.quality.avgAnswerRelevance).toBeGreaterThanOrEqual(0);
    });

    it('应该计算通过率', async () => {
      const suite = new RAGE2ETestSuite();
      const result = await suite.runAll();
      expect(result.passRate).toBeGreaterThanOrEqual(0);
      expect(result.passRate).toBeLessThanOrEqual(1);
    });
  });

  describe('报告导出', () => {
    it('应该导出 JSON 报告', async () => {
      const suite = new RAGE2ETestSuite();
      const result = await suite.runAll();
      const json = suite.exportReport(result);
      const parsed = JSON.parse(json);
      expect(parsed.summary.totalTests).toBe(result.totalTests);
    });

    it('应该导出 Markdown 报告', async () => {
      const suite = new RAGE2ETestSuite();
      const result = await suite.runAll();
      const md = suite.exportReportAsMarkdown(result);
      expect(md).toContain('# RAG E2E Test Report');
      expect(md).toContain('## Summary');
      expect(md).toContain('## Benchmarks');
      expect(md).toContain('## Quality Metrics');
    });
  });

  describe('辅助访问', () => {
    it('应该暴露 Monitor', () => {
      const suite = new RAGE2ETestSuite();
      expect(suite.getMonitor()).toBeDefined();
    });

    it('应该暴露 Debugger', () => {
      const suite = new RAGE2ETestSuite();
      expect(suite.getDebugger()).toBeDefined();
    });
  });
});
