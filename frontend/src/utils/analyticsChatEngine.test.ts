/**
 * # ============================================================
 * # Analytics Chat Engine Tests (v1.0.0 Cycle 29 G29-03)
 * # ============================================================
 * # 覆盖查询/时间范围/图表/导出/历史/事件等核心功能
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AnalyticsChat } from './analyticsChatEngine';
import {
  detectQueryType,
  detectTimeRange,
  formatCurrency,
  formatNumber,
} from './analyticsChatTypes';
import { generateSampleUsageData, SAMPLE_BUDGETS } from './analyticsChatSamples';

describe('AnalyticsChat', () => {
  let chat: AnalyticsChat;

  beforeEach(() => {
    chat = new AnalyticsChat({ persist: false });
  });

  describe('初始化', () => {
    it('加载示例数据：1200 条 usage 记录', () => {
      const data = chat.getUsageData();
      expect(data.length).toBe(1200);
    });

    it('加载 3 个预算', () => {
      const budgets = chat.getBudgets();
      expect(budgets.length).toBe(3);
    });

    it('初始历史为空', () => {
      expect(chat.getHistory().length).toBe(0);
    });
  });

  describe('query - 自然语言查询', () => {
    it('按团队查询', async () => {
      const r = await chat.query('上个季度哪个团队用了最多 token？');
      expect(r.queryType).toBe('usage-by-team');
      expect(r.answer).toBeDefined();
      expect(r.followUpQuestions.length).toBeGreaterThan(0);
    });

    it('按模型查询', async () => {
      const r = await chat.query('哪个模型成本最高？');
      expect(r.queryType).toBe('usage-by-model');
    });

    it('按技能查询', async () => {
      const r = await chat.query('code-review 技能累计调用次数？');
      expect(r.queryType).toBe('usage-by-skill');
    });

    it('成本查询', async () => {
      const r = await chat.query('最近 7 天的总成本？');
      expect(r.queryType).toBe('cost-by-period');
      expect(r.chartSpec).toBeDefined();
    });

    it('预算查询', async () => {
      const r = await chat.query('今天的预算使用率？');
      expect(r.queryType).toBe('budget-status');
    });

    it('会话统计', async () => {
      const r = await chat.query('本周的会话统计');
      expect(r.queryType).toBe('session-stats');
    });

    it('对比查询', async () => {
      const r = await chat.query('frontend-team 和 backend-team 的成本对比');
      expect(r.queryType).toBe('comparison');
    });

    it('未知查询', async () => {
      const r = await chat.query('请问今天天气如何');
      expect(r.queryType).toBe('unknown');
      expect(r.followUpQuestions.length).toBeGreaterThan(0);
    });

    it('生成 chartSpec', async () => {
      const r = await chat.query('按团队的用量');
      expect(r.chartSpec).toBeDefined();
      expect(r.chartSpec!.type).toMatch(/bar|line|pie/);
    });
  });

  describe('exportData - 数据导出', () => {
    it('JSON 格式', async () => {
      const r = await chat.query('按团队的用量');
      const json = chat.exportData(r, 'json');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('CSV 格式 - 团队', async () => {
      const r = await chat.query('按团队的用量');
      const csv = chat.exportData(r, 'csv');
      expect(csv).toContain('team,cost');
    });

    it('CSV 格式 - 模型', async () => {
      const r = await chat.query('按模型的用量');
      const csv = chat.exportData(r, 'csv');
      expect(csv).toContain('model,cost');
    });

    it('CSV 格式 - 技能', async () => {
      const r = await chat.query('code-review 技能调用次数？');
      const csv = chat.exportData(r, 'csv');
      expect(csv).toContain('skill,cost');
    });

    it('CSV 格式 - 预算', async () => {
      const r = await chat.query('预算状态');
      const csv = chat.exportData(r, 'csv');
      expect(csv).toContain('budgetId,scope');
    });
  });

  describe('历史管理', () => {
    it('查询后添加历史', async () => {
      await chat.query('按团队的用量');
      expect(chat.getHistory().length).toBe(1);
    });

    it('多次查询累积历史', async () => {
      await chat.query('查询1');
      await chat.query('查询2');
      await chat.query('查询3');
      expect(chat.getHistory().length).toBe(3);
    });

    it('清空历史', async () => {
      await chat.query('查询');
      chat.clearHistory();
      expect(chat.getHistory().length).toBe(0);
    });

    it('删除指定 turn', async () => {
      await chat.query('查询1');
      await chat.query('查询2');
      const first = chat.getHistory()[0];
      chat.deleteTurn(first.id);
      expect(chat.getHistory().length).toBe(1);
    });
  });

  describe('getSuggestedQueries - 建议查询', () => {
    it('返回建议列表', () => {
      const list = chat.getSuggestedQueries();
      expect(list.length).toBeGreaterThan(0);
    });
  });

  describe('事件订阅', () => {
    it('订阅 query-executed', async () => {
      let called = 0;
      chat.on('query-executed', () => called++);
      await chat.query('按团队的用量');
      expect(called).toBe(1);
    });

    it('订阅 chart-generated', async () => {
      let called = 0;
      chat.on('chart-generated', () => called++);
      await chat.query('按团队的用量');
      expect(called).toBe(1);
    });

    it('订阅 data-exported', async () => {
      let called = 0;
      chat.on('data-exported', () => called++);
      const r = await chat.query('按团队的用量');
      chat.exportData(r, 'csv');
      expect(called).toBe(1);
    });

    it('订阅 history-cleared', async () => {
      let called = 0;
      chat.on('history-cleared', () => called++);
      await chat.query('查询');
      chat.clearHistory();
      expect(called).toBe(1);
    });

    it('off 取消订阅', async () => {
      let called = 0;
      const handler = () => called++;
      chat.on('query-executed', handler);
      chat.off('query-executed', handler);
      await chat.query('查询');
      expect(called).toBe(0);
    });
  });

  describe('数据管理', () => {
    it('添加 usage 记录', () => {
      const before = chat.getUsageData().length;
      chat.addUsageRecord({
        id: 'rec-test',
        timestamp: Date.now(),
        model: 'gpt-4o',
        agentPath: '/test/path',
        team: 'test-team',
        project: 'test-project',
        skill: 'test-skill',
        sessionId: 'sess-test',
        promptTokens: 100,
        completionTokens: 50,
        cost: 0.001,
        status: 'success',
      });
      expect(chat.getUsageData().length).toBe(before + 1);
    });

    it('设置预算', () => {
      const newBudgets = [SAMPLE_BUDGETS[0]];
      chat.setBudgets(newBudgets);
      expect(chat.getBudgets().length).toBe(1);
    });
  });
});

describe('detectQueryType', () => {
  it('团队查询', () => {
    expect(detectQueryType('哪个团队用了最多？')).toBe('usage-by-team');
  });

  it('模型查询', () => {
    expect(detectQueryType('哪个模型最好？')).toBe('usage-by-model');
  });

  it('技能查询', () => {
    expect(detectQueryType('code-review 技能调用了几次？')).toBe('usage-by-skill');
  });

  it('成本查询', () => {
    expect(detectQueryType('本月成本？')).toBe('cost-by-period');
  });

  it('预算查询', () => {
    expect(detectQueryType('今天的预算？')).toBe('budget-status');
  });
});

describe('detectTimeRange', () => {
  it('今天', () => {
    expect(detectTimeRange('今天用了多少？')).toBe('today');
  });

  it('最近 7 天', () => {
    expect(detectTimeRange('最近 7 天的数据')).toBe('last7days');
  });

  it('一个月', () => {
    expect(detectTimeRange('本月数据')).toBe('last30days');
  });

  it('全部', () => {
    expect(detectTimeRange('所有时间')).toBe('all-time');
  });
});

describe('formatCurrency', () => {
  it('USD 格式', () => {
    expect(formatCurrency(1.2345)).toBe('$1.2345');
  });

  it('零值', () => {
    expect(formatCurrency(0)).toBe('$0.0000');
  });
});

describe('formatNumber', () => {
  it('小数字', () => {
    expect(formatNumber(123)).toBe('123');
  });

  it('千', () => {
    expect(formatNumber(1500)).toBe('1.50K');
  });

  it('百万', () => {
    expect(formatNumber(2_500_000)).toBe('2.50M');
  });
});

describe('generateSampleUsageData', () => {
  it('生成指定数量的记录', () => {
    const records = generateSampleUsageData(500);
    expect(records.length).toBe(500);
  });

  it('记录字段有效', () => {
    const records = generateSampleUsageData(100);
    const r = records[0];
    expect(r.id).toBeDefined();
    expect(r.model).toBeDefined();
    expect(r.team).toBeDefined();
    expect(r.cost).toBeGreaterThan(0);
  });
});
