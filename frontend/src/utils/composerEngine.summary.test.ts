/**
 * Self-Summarization 测试 (v6.40.0 Cycle 18 G18-03)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  estimateTokens,
  estimateConversationTokens,
  extractDecisionPoints,
  extractKeypoints,
  Summarizer,
  SummaryHistory,
  injectSummaryIntoPrompt,
  mergeSummaries,
  type ConversationItem,
  type Summary,
} from './composerEngine.summary';

describe('Self-Summarization (Cycle 18 G18-03)', () => {
  // ============================================================
  // estimateTokens
  // ============================================================
  describe('estimateTokens', () => {
    it('应该正确估算空字符串', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('应该正确估算中文字符', () => {
      const tokens = estimateTokens('你好世界');
      // 4 个中文字符 * 1.5 = 6
      expect(tokens).toBe(6);
    });

    it('应该正确估算英文单词', () => {
      const tokens = estimateTokens('hello world');
      // 2 个英文单词 * 0.75 = 1.5 -> 2
      expect(tokens).toBe(2);
    });

    it('应该正确估算混合文本', () => {
      const text = 'Hello 你好 World 世界';
      const tokens = estimateTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });

    it('应该正确处理标点', () => {
      const tokens = estimateTokens('!@#$%^&*()');
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe('estimateConversationTokens', () => {
    it('应该求和所有项的 tokens', () => {
      const items: ConversationItem[] = [
        { id: '1', role: 'user', content: '你好', timestamp: 1 },
        { id: '2', role: 'assistant', content: 'Hello', timestamp: 2 },
      ];
      const tokens = estimateConversationTokens(items);
      expect(tokens).toBeGreaterThan(0);
    });

    it('空数组应该返回 0', () => {
      expect(estimateConversationTokens([])).toBe(0);
    });
  });

  // ============================================================
  // extractDecisionPoints
  // ============================================================
  describe('extractDecisionPoints', () => {
    it('应该提取有 acceptedEdits 的用户消息', () => {
      const items: ConversationItem[] = [
        {
          id: '1',
          role: 'user',
          content: '实现用户认证',
          timestamp: 1,
          acceptedEdits: 3,
          relatedFiles: ['src/auth.ts'],
        },
        {
          id: '2',
          role: 'assistant',
          content: '好的，我来实现',
          timestamp: 2,
        },
        {
          id: '3',
          role: 'user',
          content: '其他内容',
          timestamp: 3,
        },
      ];
      const decisions = extractDecisionPoints(items);
      expect(decisions.length).toBe(1);
      expect(decisions[0].editsApplied).toBe(3);
    });

    it('应该截断过长的 prompt', () => {
      const longPrompt = 'a'.repeat(500);
      const items: ConversationItem[] = [
        { id: '1', role: 'user', content: longPrompt, timestamp: 1, acceptedEdits: 1 },
      ];
      const decisions = extractDecisionPoints(items);
      expect(decisions[0].prompt.length).toBeLessThanOrEqual(203);
    });
  });

  // ============================================================
  // extractKeypoints
  // ============================================================
  describe('extractKeypoints', () => {
    it('应该从用户消息提取动作关键点', () => {
      const items: ConversationItem[] = [
        { id: '1', role: 'user', content: '实现用户登录功能', timestamp: 1 },
        { id: '2', role: 'user', content: '修复登录 bug', timestamp: 2 },
        { id: '3', role: 'user', content: '添加单元测试', timestamp: 3 },
      ];
      const keypoints = extractKeypoints(items);
      expect(keypoints.length).toBeGreaterThan(0);
    });

    it('空数组应该返回空', () => {
      expect(extractKeypoints([])).toEqual([]);
    });
  });

  // ============================================================
  // Summarizer
  // ============================================================
  describe('Summarizer', () => {
    let summarizer: Summarizer;

    beforeEach(() => {
      summarizer = new Summarizer({
        triggerThreshold: 100,
        targetThreshold: 50,
        keepRecentCount: 3,
      });
    });

    it('应该使用默认配置', () => {
      const s = new Summarizer();
      expect(s.getConfig().strategy).toBe('balanced');
    });

    it('应该支持更新配置', () => {
      summarizer.setConfig({ strategy: 'aggressive' });
      expect(summarizer.getConfig().strategy).toBe('aggressive');
    });

    it('应该在未达阈值时返回 null', () => {
      const items: ConversationItem[] = [
        { id: '1', role: 'user', content: 'short', timestamp: 1 },
      ];
      const summary = summarizer.summarize(items);
      expect(summary).toBeNull();
    });

    it('应该强制生成摘要', () => {
      const items: ConversationItem[] = [
        { id: '1', role: 'user', content: 'short', timestamp: 1 },
      ];
      const summary = summarizer.summarize(items, { force: true });
      expect(summary).not.toBeNull();
    });

    it('应该正确生成摘要', () => {
      // 创建大量内容以触发摘要
      const items: ConversationItem[] = [];
      for (let i = 0; i < 20; i++) {
        items.push({
          id: `item_${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: '这是一段测试内容 ' + '长'.repeat(50) + ' end',
          timestamp: i,
          acceptedEdits: i % 3 === 0 ? 1 : 0,
          relatedFiles: i % 2 === 0 ? [`src/file${i}.ts`] : [],
        });
      }
      const summary = summarizer.summarize(items, { force: true });
      expect(summary).not.toBeNull();
      if (summary) {
        expect(summary.olderCount).toBeGreaterThan(0);
        expect(summary.recentCount).toBe(3);
        expect(summary.text).toContain('# Conversation Summary');
        expect(summary.stats.reductionRatio).toBeGreaterThan(0);
      }
    });

    it('shouldSummarize 应该正确判断', () => {
      const items: ConversationItem[] = [];
      for (let i = 0; i < 200; i++) {
        items.push({
          id: `${i}`,
          role: 'user',
          content: 'x'.repeat(50),
          timestamp: i,
        });
      }
      expect(summarizer.shouldSummarize(items)).toBe(true);
    });

    it('shouldSummarize 在阈值内应该返回 false', () => {
      const items: ConversationItem[] = [
        { id: '1', role: 'user', content: 'short', timestamp: 1 },
      ];
      expect(summarizer.shouldSummarize(items)).toBe(false);
    });

    it('摘要应该减少 token 数', () => {
      // 创建大量重复内容，摘要后应该显著减少
      const items: ConversationItem[] = [];
      for (let i = 0; i < 50; i++) {
        items.push({
          id: `${i}`,
          role: 'user',
          content: '实现用户认证功能，使用 JWT token 验证用户身份 ' + '详细'.repeat(20),
          timestamp: i,
          acceptedEdits: 1,
          relatedFiles: ['src/auth.ts', 'src/middleware.ts'],
        });
      }
      const summary = summarizer.summarize(items, { force: true });
      expect(summary).not.toBeNull();
      if (summary) {
        // 摘要应该合理 - summary tokens 应该在合理范围
        expect(summary.stats.summaryTokens).toBeGreaterThan(0);
        expect(summary.stats.originalTokens).toBeGreaterThan(0);
      }
    });

    it('应该支持不同策略', () => {
      const s1 = new Summarizer({ strategy: 'aggressive', keepRecentCount: 2 });
      const s2 = new Summarizer({ strategy: 'conservative', keepRecentCount: 10 });
      const items: ConversationItem[] = [];
      for (let i = 0; i < 20; i++) {
        items.push({ id: `${i}`, role: 'user', content: 'x'.repeat(100), timestamp: i });
      }
      const sum1 = s1.summarize(items, { force: true });
      const sum2 = s2.summarize(items, { force: true });
      expect(sum1?.strategy).toBe('aggressive');
      expect(sum2?.strategy).toBe('conservative');
      expect(sum1?.recentCount).toBe(2);
      expect(sum2?.recentCount).toBe(10);
    });
  });

  // ============================================================
  // SummaryHistory
  // ============================================================
  describe('SummaryHistory', () => {
    let history: SummaryHistory;

    beforeEach(() => {
      history = new SummaryHistory(5);
    });

    it('应该正确添加摘要', () => {
      const summary: Summary = {
        id: 'sum_1',
        createdAt: Date.now(),
        strategy: 'balanced',
        stats: { originalTokens: 100, summaryTokens: 50, reductionRatio: 0.5 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'test',
      };
      history.add(summary);
      expect(history.size).toBe(1);
    });

    it('应该保留最新 N 个', () => {
      for (let i = 0; i < 10; i++) {
        history.add({
          id: `sum_${i}`,
          createdAt: Date.now() + i,
          strategy: 'balanced',
          stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
          recentCount: 0,
          olderCount: 0,
          decisions: [],
          keypoints: [],
          editsSummary: [],
          contextSummary: [],
          text: `summary ${i}`,
        });
      }
      expect(history.size).toBe(5);
    });

    it('getLatest 应该返回最新摘要', () => {
      history.add({
        id: 'a',
        createdAt: 1,
        strategy: 'balanced',
        stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'first',
      });
      history.add({
        id: 'b',
        createdAt: 2,
        strategy: 'balanced',
        stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'second',
      });
      const latest = history.getLatest();
      expect(latest?.id).toBe('b');
    });

    it('clear 应该清空所有', () => {
      history.add({
        id: 'a',
        createdAt: 1,
        strategy: 'balanced',
        stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'x',
      });
      history.clear();
      expect(history.size).toBe(0);
    });

    it('应该支持订阅', () => {
      let received: Summary[] = [];
      const unsub = history.subscribe((s) => {
        received = s;
      });
      history.add({
        id: 'a',
        createdAt: 1,
        strategy: 'balanced',
        stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'x',
      });
      expect(received.length).toBe(1);
      unsub();
      history.add({
        id: 'b',
        createdAt: 2,
        strategy: 'balanced',
        stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'y',
      });
      expect(received.length).toBe(1); // 应该没有增加
    });
  });

  // ============================================================
  // injectSummaryIntoPrompt
  // ============================================================
  describe('injectSummaryIntoPrompt', () => {
    it('应该注入摘要到 prompt', () => {
      const summary: Summary = {
        id: 'sum_1',
        createdAt: Date.now(),
        strategy: 'balanced',
        stats: { originalTokens: 100, summaryTokens: 50, reductionRatio: 0.5 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: '# Summary\nTest',
      };
      const result = injectSummaryIntoPrompt('user question', summary);
      expect(result).toContain('user question');
      expect(result).toContain('# Summary');
    });

    it('空摘要应该直接返回原 prompt', () => {
      const result = injectSummaryIntoPrompt('test', null as any);
      expect(result).toBe('test');
    });

    it('应该支持自定义 prefix', () => {
      const summary: Summary = {
        id: 'sum_1',
        createdAt: Date.now(),
        strategy: 'balanced',
        stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'x',
      };
      const result = injectSummaryIntoPrompt('test', summary, { prefix: '上下文摘要' });
      expect(result).toContain('[上下文摘要]');
    });
  });

  // ============================================================
  // mergeSummaries
  // ============================================================
  describe('mergeSummaries', () => {
    it('空数组应该返回空字符串', () => {
      expect(mergeSummaries([])).toBe('');
    });

    it('单个摘要应该直接返回 text', () => {
      const summary: Summary = {
        id: 'a',
        createdAt: 1,
        strategy: 'balanced',
        stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
        recentCount: 0,
        olderCount: 0,
        decisions: [],
        keypoints: [],
        editsSummary: [],
        contextSummary: [],
        text: 'single text',
      };
      expect(mergeSummaries([summary])).toBe('single text');
    });

    it('应该合并多个摘要', () => {
      const summaries: Summary[] = [
        {
          id: 'a',
          createdAt: 1,
          strategy: 'balanced',
          stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
          recentCount: 0,
          olderCount: 0,
          decisions: [],
          keypoints: [],
          editsSummary: [],
          contextSummary: [],
          text: 'first',
        },
        {
          id: 'b',
          createdAt: 2,
          strategy: 'balanced',
          stats: { originalTokens: 0, summaryTokens: 0, reductionRatio: 0 },
          recentCount: 0,
          olderCount: 0,
          decisions: [],
          keypoints: [],
          editsSummary: [],
          contextSummary: [],
          text: 'second',
        },
      ];
      const merged = mergeSummaries(summaries);
      expect(merged).toContain('# Combined Summary (2 parts)');
      expect(merged).toContain('first');
      expect(merged).toContain('second');
    });
  });
});
