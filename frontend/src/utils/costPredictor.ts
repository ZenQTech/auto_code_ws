/**
 * # ============================================================
 * # CostPredictor - 成本预测器 (v1.0.0 Cycle 22 G22-02)
 * # ============================================================
 * # 核心作用：基于历史成本数据预测未来开销 + 预算告警
 * # 业务价值：
 * #   1. 提前规划预算
 * #   2. 多种预测算法（简单/线性/指数平滑/季节性）
 * #   3. 预算告警实时触发
 * #   4. 趋势可视化数据
 * # 运行流程：
 * #   1. 从 ModelCostStatsCollector 拉取历史数据
 * #   2. 应用预测算法生成未来 N 天预测
 * #   3. 与预算对比生成告警
 * # 输入参数：
 * #   - history: 历史成本数据
 * #   - days: 预测天数
 * #   - mode: 预测模式
 * # 输出结果：
 * #   - DailyCostPrediction[]: 每日预测
 * #   - BudgetStatus: 预算状态
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 22 G22-02 初次创建
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

export type PredictionMode = 'simple' | 'linear' | 'exponential' | 'seasonal';

export type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface CostDataPoint {
  date: string; // YYYY-MM-DD
  cost: number;
  tokens?: number;
  callCount?: number;
}

export interface DailyCostPrediction {
  date: string;
  predicted: number;
  lowerBound: number; // 95% 置信区间下界
  upperBound: number; // 95% 置信区间上界
  confidence: number; // 0-1
}

export interface PredictionResult {
  mode: PredictionMode;
  generatedAt: number;
  historyDays: number;
  predictions: DailyCostPrediction[];
  totalPredicted: number;
  averageDaily: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  accuracy: number; // 0-1，基于历史回测
}

export interface BudgetConfig {
  daily?: number;
  weekly?: number;
  monthly?: number;
  alertThreshold: number; // 0-1，触发告警的百分比（默认 0.8）
}

export interface BudgetStatus {
  daily: { spent: number; budget: number; percentage: number; status: 'ok' | 'warning' | 'exceeded' };
  weekly: { spent: number; budget: number; percentage: number; status: 'ok' | 'warning' | 'exceeded' };
  monthly: { spent: number; budget: number; percentage: number; status: 'ok' | 'warning' | 'exceeded' };
}

export interface CostAlert {
  alertId: string;
  period: BudgetPeriod;
  severity: AlertSeverity;
  message: string;
  spent: number;
  budget: number;
  percentage: number;
  triggeredAt: number;
}

// ============================================================================
// 预测算法
// ============================================================================

/**
 * 简单平均预测
 */
function _simplePredict(history: CostDataPoint[], days: number): DailyCostPrediction[] {
  if (history.length === 0) return [];
  const avg = history.reduce((sum, p) => sum + p.cost, 0) / history.length;
  const variance = history.reduce((sum, p) => sum + Math.pow(p.cost - avg, 2), 0) / history.length;
  const stdDev = Math.sqrt(variance);

  const predictions: DailyCostPrediction[] = [];
  const lastDate = new Date(history[history.length - 1].date);
  for (let i = 1; i <= days; i++) {
    const d = new Date(lastDate);
    d.setDate(d.getDate() + i);
    predictions.push({
      date: d.toISOString().slice(0, 10),
      predicted: avg,
      lowerBound: Math.max(0, avg - 1.96 * stdDev),
      upperBound: avg + 1.96 * stdDev,
      confidence: 0.5,
    });
  }
  return predictions;
}

/**
 * 线性回归预测
 */
function _linearPredict(history: CostDataPoint[], days: number): DailyCostPrediction[] {
  if (history.length < 2) return _simplePredict(history, days);

  const n = history.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const ys = history.map((p) => p.cost);
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((s, y) => s + y, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += Math.pow(xs[i] - xMean, 2);
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  // 残差方差
  let residualVar = 0;
  for (let i = 0; i < n; i++) {
    const predicted = intercept + slope * i;
    residualVar += Math.pow(ys[i] - predicted, 2);
  }
  residualVar /= n - 2;
  const residualStdDev = Math.sqrt(residualVar);

  // 预测
  const predictions: DailyCostPrediction[] = [];
  const lastDate = new Date(history[history.length - 1].date);
  for (let i = 1; i <= days; i++) {
    const x = n - 1 + i;
    const pred = intercept + slope * x;
    const se = residualStdDev * Math.sqrt(1 + 1 / n + Math.pow(x - xMean, 2) / den);
    const d = new Date(lastDate);
    d.setDate(d.getDate() + i);
    predictions.push({
      date: d.toISOString().slice(0, 10),
      predicted: Math.max(0, pred),
      lowerBound: Math.max(0, pred - 1.96 * se),
      upperBound: pred + 1.96 * se,
      confidence: 0.7,
    });
  }
  return predictions;
}

/**
 * 指数平滑预测 (Holt's linear method)
 */
function _exponentialPredict(history: CostDataPoint[], days: number): DailyCostPrediction[] {
  if (history.length < 2) return _simplePredict(history, days);

  const alpha = 0.5; // 平滑参数
  const beta = 0.3; // 趋势平滑参数
  const ys = history.map((p) => p.cost);

  let level = ys[0];
  let trend = ys[1] - ys[0];

  for (let i = 1; i < ys.length; i++) {
    const lastLevel = level;
    level = alpha * ys[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - lastLevel) + (1 - beta) * trend;
  }

  // 残差
  const residuals: number[] = [];
  let l = ys[0];
  let t = ys[1] - ys[0];
  for (let i = 1; i < ys.length; i++) {
    const pred = l + t;
    residuals.push(ys[i] - pred);
    const lastL = l;
    l = alpha * ys[i] + (1 - alpha) * (l + t);
    t = beta * (l - lastL) + (1 - beta) * t;
  }
  const residualStdDev = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);

  const predictions: DailyCostPrediction[] = [];
  const lastDate = new Date(history[history.length - 1].date);
  for (let i = 1; i <= days; i++) {
    const pred = level + i * trend;
    const d = new Date(lastDate);
    d.setDate(d.getDate() + i);
    predictions.push({
      date: d.toISOString().slice(0, 10),
      predicted: Math.max(0, pred),
      lowerBound: Math.max(0, pred - 1.96 * residualStdDev),
      upperBound: pred + 1.96 * residualStdDev,
      confidence: 0.75,
    });
  }
  return predictions;
}

/**
 * 季节性预测（周周期）
 */
function _seasonalPredict(history: CostDataPoint[], days: number): DailyCostPrediction[] {
  if (history.length < 14) {
    // 数据不足，使用指数平滑
    return _exponentialPredict(history, days);
  }

  const weekly = new Array(7).fill(0);
  const weeklyCount = new Array(7).fill(0);

  for (const p of history) {
    const day = new Date(p.date).getDay();
    weekly[day] += p.cost;
    weeklyCount[day]++;
  }

  const seasonalIndices = weekly.map((sum, i) => (weeklyCount[i] > 0 ? sum / weeklyCount[i] : 0));
  const baseAvg = seasonalIndices.reduce((s, v) => s + v, 0) / 7;

  // 基础趋势（使用线性回归）
  const linear = _linearPredict(history, days);

  const predictions: DailyCostPrediction[] = [];
  for (let i = 0; i < linear.length; i++) {
    const targetDate = new Date(linear[i].date);
    const dayOfWeek = targetDate.getDay();
    const seasonalFactor = baseAvg > 0 ? seasonalIndices[dayOfWeek] / baseAvg : 1;
    const adjusted = linear[i].predicted * seasonalFactor;
    const spread = (linear[i].upperBound - linear[i].lowerBound) * seasonalFactor;
    predictions.push({
      date: linear[i].date,
      predicted: Math.max(0, adjusted),
      lowerBound: Math.max(0, adjusted - spread / 2),
      upperBound: adjusted + spread / 2,
      confidence: 0.8,
    });
  }
  return predictions;
}

// ============================================================================
// 准确率评估
// ============================================================================

/**
 * 回测评估预测准确率
 */
function _evaluateAccuracy(history: CostDataPoint[], mode: PredictionMode): number {
  if (history.length < 5) return 0.5;

  // 留出最后 20% 作为测试集
  const splitIdx = Math.floor(history.length * 0.8);
  const train = history.slice(0, splitIdx);
  const test = history.slice(splitIdx);

  if (test.length === 0) return 0.5;

  const predictions = _predictWithMode(train, test.length, mode);
  if (predictions.length === 0) return 0.5;

  // 计算 MAPE
  let totalError = 0;
  for (let i = 0; i < test.length; i++) {
    if (test[i].cost > 0) {
      totalError += Math.abs(predictions[i].predicted - test[i].cost) / test[i].cost;
    }
  }
  const mape = totalError / test.length;
  // 准确率 = 1 - MAPE，限制在 0-1
  return Math.max(0, Math.min(1, 1 - mape));
}

function _predictWithMode(history: CostDataPoint[], days: number, mode: PredictionMode): DailyCostPrediction[] {
  switch (mode) {
    case 'simple': return _simplePredict(history, days);
    case 'linear': return _linearPredict(history, days);
    case 'exponential': return _exponentialPredict(history, days);
    case 'seasonal': return _seasonalPredict(history, days);
    default: return _simplePredict(history, days);
  }
}

// ============================================================================
// 核心类
// ============================================================================

export class CostPredictor {
  private budget: BudgetConfig = {
    alertThreshold: 0.8,
  };
  private activeAlerts: Map<string, CostAlert> = new Map();

  // --------------------------------------------------------------------------
  // 预测
  // --------------------------------------------------------------------------

  /**
   * 预测未来 N 天成本
   */
  predict(history: CostDataPoint[], days: number, mode: PredictionMode = 'exponential'): PredictionResult {
    const predictions = _predictWithMode(history, days, mode);
    const totalPredicted = predictions.reduce((s, p) => s + p.predicted, 0);
    const averageDaily = days > 0 ? totalPredicted / days : 0;

    // 趋势判断
    const firstHalf = predictions.slice(0, Math.floor(predictions.length / 2));
    const secondHalf = predictions.slice(Math.floor(predictions.length / 2));
    const firstAvg = firstHalf.length > 0 ? firstHalf.reduce((s, p) => s + p.predicted, 0) / firstHalf.length : 0;
    const secondAvg = secondHalf.length > 0 ? secondHalf.reduce((s, p) => s + p.predicted, 0) / secondHalf.length : 0;
    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (secondAvg > firstAvg * 1.05) trend = 'increasing';
    else if (secondAvg < firstAvg * 0.95) trend = 'decreasing';

    const accuracy = _evaluateAccuracy(history, mode);

    return {
      mode,
      generatedAt: Date.now(),
      historyDays: history.length,
      predictions,
      totalPredicted,
      averageDaily,
      trend,
      accuracy,
    };
  }

  /**
   * 多模式预测（取准确率最高的）
   */
  predictBest(history: CostDataPoint[], days: number): PredictionResult {
    const modes: PredictionMode[] = ['simple', 'linear', 'exponential', 'seasonal'];
    const results = modes.map((m) => this.predict(history, days, m));
    results.sort((a, b) => b.accuracy - a.accuracy);
    return results[0];
  }

  /**
   * 预测指定月份成本
   */
  predictMonthly(history: CostDataPoint[], yearMonth: string, mode: PredictionMode = 'exponential'): { predicted: number; daily: DailyCostPrediction[] } {
    const [year, month] = yearMonth.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const result = this.predict(history, daysInMonth, mode);
    return {
      predicted: result.totalPredicted,
      daily: result.predictions,
    };
  }

  // --------------------------------------------------------------------------
  // 预算管理
  // --------------------------------------------------------------------------

  /**
   * 设置预算
   */
  setBudget(period: BudgetPeriod, amount: number): void {
    this.budget[period] = amount;
  }

  /**
   * 设置告警阈值
   */
  setAlertThreshold(threshold: number): void {
    this.budget.alertThreshold = Math.max(0, Math.min(1, threshold));
  }

  /**
   * 获取预算状态
   */
  getBudgetStatus(history: CostDataPoint[]): BudgetStatus {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    const weekStartStr = weekStart.toISOString().slice(0, 10);
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

    const dailySpent = history.filter((p) => p.date === today).reduce((s, p) => s + p.cost, 0);
    const weeklySpent = history.filter((p) => p.date >= weekStartStr).reduce((s, p) => s + p.cost, 0);
    const monthlySpent = history.filter((p) => p.date >= monthStart).reduce((s, p) => s + p.cost, 0);

    return {
      daily: this._calcPeriod(dailySpent, this.budget.daily),
      weekly: this._calcPeriod(weeklySpent, this.budget.weekly),
      monthly: this._calcPeriod(monthlySpent, this.budget.monthly),
    };
  }

  /**
   * 计算单周期状态
   */
  private _calcPeriod(spent: number, budget: number | undefined): BudgetStatus['daily'] {
    if (budget === undefined || budget <= 0) {
      return { spent, budget: 0, percentage: 0, status: 'ok' };
    }
    const percentage = spent / budget;
    let status: 'ok' | 'warning' | 'exceeded' = 'ok';
    if (percentage >= 1) status = 'exceeded';
    else if (percentage >= this.budget.alertThreshold) status = 'warning';
    return { spent, budget, percentage, status };
  }

  /**
   * 检查告警
   */
  checkAlerts(history: CostDataPoint[]): CostAlert[] {
    const status = this.getBudgetStatus(history);
    const alerts: CostAlert[] = [];
    const now = Date.now();

    for (const [period, info] of Object.entries(status) as [BudgetPeriod, BudgetStatus['daily']][]) {
      if (info.status === 'ok' || info.budget === 0) continue;
      const alertId = `${period}-${now}`;
      const alert: CostAlert = {
        alertId,
        period,
        severity: info.status === 'exceeded' ? 'critical' : 'warning',
        message: `${period} 预算${info.status === 'exceeded' ? '已超支' : '接近上限'}: ${(info.percentage * 100).toFixed(1)}% (${info.spent.toFixed(2)} / ${info.budget.toFixed(2)})`,
        spent: info.spent,
        budget: info.budget,
        percentage: info.percentage,
        triggeredAt: now,
      };
      alerts.push(alert);
      this.activeAlerts.set(alertId, alert);
    }

    return alerts;
  }

  /**
   * 清除活跃告警
   */
  clearAlerts(): void {
    this.activeAlerts.clear();
  }

  /**
   * 获取活跃告警
   */
  getActiveAlerts(): CostAlert[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * 获取预算配置
   */
  getBudget(): BudgetConfig {
    return { ...this.budget };
  }

  /**
   * 预测 + 预算告警组合
   */
  predictWithBudgetCheck(history: CostDataPoint[], days: number, mode: PredictionMode = 'exponential'): { prediction: PredictionResult; alerts: CostAlert[]; budget: BudgetStatus } {
    const prediction = this.predict(history, days, mode);
    const alerts = this.checkAlerts(history);
    const budget = this.getBudgetStatus(history);
    return { prediction, alerts, budget };
  }
}

// ============================================================================
// 单例
// ============================================================================

let _instance: CostPredictor | null = null;

export function getCostPredictor(): CostPredictor {
  if (!_instance) {
    _instance = new CostPredictor();
  }
  return _instance;
}

export function resetCostPredictor(): void {
  if (_instance) {
    _instance.clearAlerts();
  }
  _instance = null;
}

export function isCostPredictorInitialized(): boolean {
  return _instance !== null;
}
