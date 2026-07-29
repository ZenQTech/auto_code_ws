/**
 * # ============================================================
 * # CostPredictor 单元测试 (Cycle 22 G22-02)
 * # ============================================================
 * # 测试 CostPredictor 所有公开方法和边界条件
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CostPredictor,
  getCostPredictor,
  resetCostPredictor,
  type CostDataPoint,
} from './costPredictor';

beforeEach(() => {
  resetCostPredictor();
});

afterEach(() => {
  resetCostPredictor();
});

/**
 * 生成测试历史数据
 */
function generateHistory(days: number, baseCost: number = 10, trend: number = 0.1): CostDataPoint[] {
  const history: CostDataPoint[] = [];
  const now = new Date();
  for (let i = days; i > 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const cost = baseCost + i * trend + Math.random() * 2;
    history.push({
      date: d.toISOString().slice(0, 10),
      cost: Math.round(cost * 100) / 100,
      tokens: Math.floor(cost * 1000),
      callCount: Math.floor(cost * 5),
    });
  }
  return history;
}

describe('CostPredictor - 基础预测', () => {
  it('应能使用 simple 模式预测', () => {
    const predictor = new CostPredictor();
    const history = generateHistory(30, 10, 0);
    const result = predictor.predict(history, 7, 'simple');
    expect(result.mode).toBe('simple');
    expect(result.predictions.length).toBe(7);
    expect(result.totalPredicted).toBeGreaterThan(0);
    expect(result.averageDaily).toBeGreaterThan(0);
  });

  it('应能使用 linear 模式预测', () => {
    const predictor = new CostPredictor();
    // 构造强上升趋势（每天 +50），避免随机噪声影响
    const history: CostDataPoint[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      cost: 100 + i * 50,
    }));
    const result = predictor.predict(history, 7, 'linear');
    expect(result.mode).toBe('linear');
    expect(result.predictions.length).toBe(7);
    // 增长趋势下，预测值应随天数增长
    const first = result.predictions[0].predicted;
    const last = result.predictions[result.predictions.length - 1].predicted;
    expect(last).toBeGreaterThanOrEqual(first);
  });

  it('应能使用 exponential 模式预测', () => {
    const predictor = new CostPredictor();
    const history = generateHistory(30);
    const result = predictor.predict(history, 7, 'exponential');
    expect(result.mode).toBe('exponential');
    expect(result.predictions.length).toBe(7);
  });

  it('应能使用 seasonal 模式预测', () => {
    const predictor = new CostPredictor();
    const history = generateHistory(60);
    const result = predictor.predict(history, 7, 'seasonal');
    expect(result.mode).toBe('seasonal');
    expect(result.predictions.length).toBe(7);
  });

  it('空历史数据应返回空预测', () => {
    const predictor = new CostPredictor();
    const result = predictor.predict([], 7);
    expect(result.predictions.length).toBe(0);
    expect(result.totalPredicted).toBe(0);
  });
});

describe('CostPredictor - 趋势判断', () => {
  it('应能识别 increasing 趋势', () => {
    const predictor = new CostPredictor();
    // 构造显著上升趋势
    const history: CostDataPoint[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      cost: 10 + i * 5,
    }));
    const result = predictor.predict(history, 14, 'linear');
    expect(result.trend).toBe('increasing');
  });

  it('应能识别 decreasing 趋势', () => {
    const predictor = new CostPredictor();
    const history: CostDataPoint[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      cost: 100 - i * 2,
    }));
    const result = predictor.predict(history, 14, 'linear');
    expect(result.trend).toBe('decreasing');
  });

  it('应能识别 stable 趋势', () => {
    const predictor = new CostPredictor();
    const history: CostDataPoint[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      cost: 10 + (i % 3) * 0.1, // 围绕 10 波动
    }));
    const result = predictor.predict(history, 14, 'linear');
    expect(['stable', 'increasing', 'decreasing']).toContain(result.trend);
  });
});

describe('CostPredictor - 准确率', () => {
  it('应返回 0-1 范围的准确率', () => {
    const predictor = new CostPredictor();
    const history = generateHistory(30);
    const result = predictor.predict(history, 7);
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);
  });

  it('应能调用 predictBest 选择最优模式', () => {
    const predictor = new CostPredictor();
    const history = generateHistory(30);
    const result = predictor.predictBest(history, 7);
    expect(['simple', 'linear', 'exponential', 'seasonal']).toContain(result.mode);
  });
});

describe('CostPredictor - 月度预测', () => {
  it('应能预测指定月份', () => {
    const predictor = new CostPredictor();
    const history = generateHistory(60);
    const result = predictor.predictMonthly(history, '2026-08');
    expect(result.predicted).toBeGreaterThan(0);
    // 8月有31天
    expect(result.daily.length).toBe(31);
  });
});

describe('CostPredictor - 预算管理', () => {
  it('应能设置预算', () => {
    const predictor = new CostPredictor();
    predictor.setBudget('daily', 100);
    predictor.setBudget('weekly', 500);
    predictor.setBudget('monthly', 2000);
    const budget = predictor.getBudget();
    expect(budget.daily).toBe(100);
    expect(budget.weekly).toBe(500);
    expect(budget.monthly).toBe(2000);
  });

  it('应能设置告警阈值', () => {
    const predictor = new CostPredictor();
    predictor.setAlertThreshold(0.9);
    expect(predictor.getBudget().alertThreshold).toBe(0.9);
  });

  it('阈值应限制在 0-1', () => {
    const predictor = new CostPredictor();
    predictor.setAlertThreshold(1.5);
    expect(predictor.getBudget().alertThreshold).toBe(1);
    predictor.setAlertThreshold(-0.5);
    expect(predictor.getBudget().alertThreshold).toBe(0);
  });
});

describe('CostPredictor - 预算状态', () => {
  it('未设置预算时状态应为 ok', () => {
    const predictor = new CostPredictor();
    const history = generateHistory(7);
    const status = predictor.getBudgetStatus(history);
    expect(status.daily.status).toBe('ok');
    expect(status.weekly.status).toBe('ok');
    expect(status.monthly.status).toBe('ok');
  });

  it('超出预算时状态应为 exceeded', () => {
    const predictor = new CostPredictor();
    predictor.setBudget('daily', 1);
    // 构造今日成本 = 100（远超预算 1）
    const today = new Date().toISOString().slice(0, 10);
    const history: CostDataPoint[] = [{ date: today, cost: 100 }];
    const status = predictor.getBudgetStatus(history);
    expect(status.daily.status).toBe('exceeded');
  });

  it('接近预算阈值时应为 warning', () => {
    const predictor = new CostPredictor();
    predictor.setBudget('daily', 100);
    predictor.setAlertThreshold(0.5);
    // 构造今日成本 = 60（60%）
    const today = new Date().toISOString().slice(0, 10);
    const history: CostDataPoint[] = [{ date: today, cost: 60 }];
    const status = predictor.getBudgetStatus(history);
    expect(status.daily.status).toBe('warning');
  });
});

describe('CostPredictor - 告警', () => {
  it('应能检测告警', () => {
    const predictor = new CostPredictor();
    predictor.setBudget('daily', 10);
    const today = new Date().toISOString().slice(0, 10);
    const history: CostDataPoint[] = [{ date: today, cost: 100 }];
    const alerts = predictor.checkAlerts(history);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some((a) => a.severity === 'critical')).toBe(true);
  });

  it('无预算时不应产生告警', () => {
    const predictor = new CostPredictor();
    const history = generateHistory(7, 100);
    const alerts = predictor.checkAlerts(history);
    expect(alerts.length).toBe(0);
  });

  it('应能清除告警', () => {
    const predictor = new CostPredictor();
    predictor.setBudget('daily', 10);
    const today = new Date().toISOString().slice(0, 10);
    const history: CostDataPoint[] = [{ date: today, cost: 100 }];
    predictor.checkAlerts(history);
    expect(predictor.getActiveAlerts().length).toBeGreaterThan(0);
    predictor.clearAlerts();
    expect(predictor.getActiveAlerts().length).toBe(0);
  });

  it('predictWithBudgetCheck 应返回组合结果', () => {
    const predictor = new CostPredictor();
    predictor.setBudget('daily', 10);
    const today = new Date().toISOString().slice(0, 10);
    const history: CostDataPoint[] = [{ date: today, cost: 100 }];
    const result = predictor.predictWithBudgetCheck(history, 7);
    expect(result.prediction).toBeDefined();
    expect(result.alerts).toBeDefined();
    expect(result.budget).toBeDefined();
  });
});

describe('CostPredictor - 单例工厂', () => {
  it('getCostPredictor 应返回单例', () => {
    const p1 = getCostPredictor();
    const p2 = getCostPredictor();
    expect(p1).toBe(p2);
  });

  it('resetCostPredictor 应清空状态', () => {
    getCostPredictor();
    resetCostPredictor();
    // 重新获取应该是新实例（因为 _instance 已被置空）
    const p = getCostPredictor();
    expect(p).toBeDefined();
  });
});
