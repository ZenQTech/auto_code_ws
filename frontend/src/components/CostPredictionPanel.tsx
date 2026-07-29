/**
 * # ============================================================
 * # CostPredictionPanel - 成本预测 UI (v1.0.0 Cycle 22 G22-02)
 * # ============================================================
 * # 核心作用：成本预测与预算告警的可视化界面
 * # 主要功能：
 * #   1. 4 种预测算法选择 (simple/linear/exponential/seasonal)
 * #   2. 预测天数配置
 * #   3. 预算设置（每日/每周/每月）
 * #   4. 实时告警显示
 * #   5. 历史 vs 预测对比图（SVG）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 22 G22-02 初次创建
 * #   - 2026-07-29 | v1.0.1 | UI/UX 优化：渐变背景 + 渐入动画 + Esc 关闭
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getCostPredictor,
  type CostDataPoint,
  type PredictionResult,
  type CostAlert,
  type BudgetStatus,
  type PredictionMode,
  type BudgetPeriod,
} from '../utils/costPredictor';

interface CostPredictionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const MODE_LABELS: Record<PredictionMode, string> = {
  simple: '简单平均',
  linear: '线性回归',
  exponential: '指数平滑',
  seasonal: '季节性',
};

const PERIOD_LABELS: Record<BudgetPeriod, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
};

const SEVERITY_COLORS = {
  info: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  warning: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  critical: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
};

const STATUS_COLORS = {
  ok: 'bg-emerald-500/20 text-emerald-300',
  warning: 'bg-amber-500/20 text-amber-300',
  exceeded: 'bg-rose-500/20 text-rose-300',
};

export function CostPredictionPanel({ isOpen, onClose }: CostPredictionPanelProps) {
  const predictor = useMemo(() => getCostPredictor(), []);
  const [history, setHistory] = useState<CostDataPoint[]>([]);
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [alerts, setAlerts] = useState<CostAlert[]>([]);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);
  const [mode, setMode] = useState<PredictionMode>('exponential');
  const [days, setDays] = useState(7);
  const [budgets, setBudgets] = useState({ daily: 50, weekly: 300, monthly: 1000 });
  const [error, setError] = useState<string | null>(null);

  // 生成模拟历史数据
  const generateSampleHistory = useCallback((n: number = 30): CostDataPoint[] => {
    const data: CostDataPoint[] = [];
    const now = new Date();
    for (let i = n; i > 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const baseCost = 20 + i * 0.5; // 上升趋势
      const noise = (Math.random() - 0.5) * 5;
      const weekend = d.getDay() === 0 || d.getDay() === 6 ? 0.7 : 1.2;
      data.push({
        date: d.toISOString().slice(0, 10),
        cost: Math.max(0, Math.round((baseCost + noise) * weekend * 100) / 100),
        tokens: Math.floor((baseCost + noise) * 1000),
        callCount: Math.floor((baseCost + noise) * 3),
      });
    }
    return data;
  }, []);

  // 加载初始数据
  useEffect(() => {
    if (!isOpen) return;
    const data = generateSampleHistory(30);
    setHistory(data);
  }, [isOpen, generateSampleHistory]);

  // 设置预算
  useEffect(() => {
    if (!isOpen) return;
    predictor.setBudget('daily', budgets.daily);
    predictor.setBudget('weekly', budgets.weekly);
    predictor.setBudget('monthly', budgets.monthly);
  }, [isOpen, predictor, budgets]);

  // 执行预测
  const runPrediction = useCallback(() => {
    setError(null);
    try {
      const result = predictor.predict(history, days, mode);
      setPrediction(result);
      const a = predictor.checkAlerts(history);
      setAlerts(a);
      const bs = predictor.getBudgetStatus(history);
      setBudgetStatus(bs);
    } catch (err) {
      setError(err instanceof Error ? err.message : '预测失败');
    }
  }, [predictor, history, days, mode]);

  // 当数据/参数变化时自动预测
  useEffect(() => {
    if (!isOpen || history.length === 0) return;
    runPrediction();
  }, [isOpen, history, days, mode, runPrediction]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 加载历史告警
  useEffect(() => {
    if (!isOpen) return;
    setAlerts(predictor.getActiveAlerts());
  }, [isOpen, predictor]);

  // 清除告警
  const handleClearAlerts = useCallback(() => {
    predictor.clearAlerts();
    setAlerts([]);
  }, [predictor]);

  // 加载示例数据
  const handleLoadSample = useCallback(() => {
    const data = generateSampleHistory(30);
    setHistory(data);
  }, [generateSampleHistory]);

  // 简单 SVG 折线图数据
  const chartData = useMemo(() => {
    if (!prediction) return null;
    const allPoints: { date: string; value: number; type: 'history' | 'prediction' }[] = [];
    history.slice(-14).forEach((p) => {
      allPoints.push({ date: p.date, value: p.cost, type: 'history' });
    });
    prediction.predictions.forEach((p) => {
      allPoints.push({ date: p.date, value: p.predicted, type: 'prediction' });
    });
    return allPoints;
  }, [prediction, history]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="cost-prediction-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
              <span className="text-white text-sm">📈</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">成本预测 / 预算告警</h2>
              <p className="text-xs text-slate-400">基于历史数据预测未来成本 + 实时预算监控</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
            aria-label="关闭"
            data-testid="cost-prediction-close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {error && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-sm">
              {error}
            </div>
          )}

          {/* 配置区 */}
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">预测模式</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as PredictionMode)}
                data-testid="cost-mode"
                className="w-full px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-white text-sm"
              >
                {(Object.keys(MODE_LABELS) as PredictionMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">预测天数</label>
              <input
                type="number"
                value={days}
                min={1}
                max={90}
                onChange={(e) => setDays(Math.max(1, Math.min(90, parseInt(e.target.value) || 7)))}
                data-testid="cost-days"
                className="w-full px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-white text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">历史数据</label>
              <button
                onClick={handleLoadSample}
                data-testid="cost-refresh"
                className="w-full px-2 py-1.5 bg-surface-700 hover:bg-surface-600 text-white text-sm rounded transition"
              >
                重新生成
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">数据条数</label>
              <div className="px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-white text-sm">
                {history.length} 天
              </div>
            </div>
          </div>

          {/* 预算设置 */}
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-2">预算设置</h3>
            <div className="grid grid-cols-3 gap-3">
              {(['daily', 'weekly', 'monthly'] as BudgetPeriod[]).map((period) => (
                <div key={period} className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 w-12">{PERIOD_LABELS[period]}</span>
                  <input
                    type="number"
                    value={budgets[period]}
                    min={0}
                    onChange={(e) =>
                      setBudgets((prev) => ({
                        ...prev,
                        [period]: Math.max(0, parseFloat(e.target.value) || 0),
                      }))
                    }
                    data-testid={`cost-budget-${period}`}
                    className="flex-1 px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-white text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 预算状态 */}
          {budgetStatus && (
            <div className="grid grid-cols-3 gap-3">
              {(['daily', 'weekly', 'monthly'] as const).map((period) => {
                const info = budgetStatus[period];
                return (
                  <div
                    key={period}
                    className="bg-surface-800 border border-surface-700 rounded-lg p-3"
                    data-testid={`cost-status-${period}`}
                  >
                    <div className="text-xs text-slate-400 mb-1">
                      {PERIOD_LABELS[period]} 预算
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-lg font-bold text-white">
                        ${info.spent.toFixed(1)}
                      </span>
                      <span className="text-xs text-slate-500">/ ${info.budget}</span>
                    </div>
                    <div className="mt-2 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          info.status === 'exceeded'
                            ? 'bg-rose-500'
                            : info.status === 'warning'
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, info.percentage * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_COLORS[info.status]}`}
                      >
                        {info.status === 'ok' ? '正常' : info.status === 'warning' ? '告警' : '超支'}
                      </span>
                      <span className="text-xs text-slate-500">
                        {(info.percentage * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 预测摘要 */}
          {prediction && (
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-surface-800 border border-surface-700 rounded-lg p-3">
                <div className="text-xs text-slate-400">总预测</div>
                <div className="text-lg font-bold text-white" data-testid="cost-total">
                  ${prediction.totalPredicted.toFixed(2)}
                </div>
              </div>
              <div className="bg-surface-800 border border-surface-700 rounded-lg p-3">
                <div className="text-xs text-slate-400">日均</div>
                <div className="text-lg font-bold text-white">
                  ${prediction.averageDaily.toFixed(2)}
                </div>
              </div>
              <div className="bg-surface-800 border border-surface-700 rounded-lg p-3">
                <div className="text-xs text-slate-400">趋势</div>
                <div
                  className={`text-lg font-bold ${
                    prediction.trend === 'increasing'
                      ? 'text-rose-400'
                      : prediction.trend === 'decreasing'
                        ? 'text-emerald-400'
                        : 'text-slate-300'
                  }`}
                >
                  {prediction.trend === 'increasing'
                    ? '↗ 上升'
                    : prediction.trend === 'decreasing'
                      ? '↘ 下降'
                      : '→ 稳定'}
                </div>
              </div>
              <div className="bg-surface-800 border border-surface-700 rounded-lg p-3">
                <div className="text-xs text-slate-400">准确率</div>
                <div className="text-lg font-bold text-white">
                  {(prediction.accuracy * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          )}

          {/* 折线图 */}
          {chartData && chartData.length > 0 && (
            <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
              <h3 className="text-sm font-medium text-slate-300 mb-3">历史 vs 预测</h3>
              <SimpleLineChart data={chartData} />
            </div>
          )}

          {/* 告警列表 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-slate-300">
                活跃告警 <span className="text-slate-500">({alerts.length})</span>
              </h3>
              {alerts.length > 0 && (
                <button
                  onClick={handleClearAlerts}
                  className="text-xs text-slate-400 hover:text-white transition"
                  data-testid="cost-clear-alerts"
                >
                  清除全部
                </button>
              )}
            </div>
            {alerts.length === 0 ? (
              <div className="text-center text-slate-500 text-sm py-4 bg-surface-800/50 rounded">
                无活跃告警
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((alert) => (
                  <div
                    key={alert.alertId}
                    className={`p-3 rounded-lg border ${SEVERITY_COLORS[alert.severity]}`}
                    data-testid={`cost-alert-${alert.severity}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{alert.message}</span>
                      <span className="text-xs">
                        {new Date(alert.triggeredAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 简单 SVG 折线图组件
function SimpleLineChart({ data }: { data: { date: string; value: number; type: 'history' | 'prediction' }[] }) {
  const width = 800;
  const height = 200;
  const padding = 30;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const minValue = Math.min(...data.map((d) => d.value), 0);
  const range = maxValue - minValue || 1;
  const xStep = (width - padding * 2) / Math.max(1, data.length - 1);

  const points = data.map((d, i) => {
    const x = padding + i * xStep;
    const y = height - padding - ((d.value - minValue) / range) * (height - padding * 2);
    return { x, y, ...d };
  });

  const historyPath = points
    .filter((p) => p.type === 'history')
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ');
  const predictionPath = points
    .filter((p) => p.type === 'prediction')
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48" data-testid="cost-chart">
      {/* 网格线 */}
      {[0, 0.25, 0.5, 0.75, 1].map((r) => (
        <line
          key={r}
          x1={padding}
          y1={padding + r * (height - padding * 2)}
          x2={width - padding}
          y2={padding + r * (height - padding * 2)}
          stroke="#334155"
          strokeDasharray="2 2"
        />
      ))}
      {/* 历史折线 */}
      {historyPath && (
        <path
          d={historyPath}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          data-testid="cost-chart-history"
        />
      )}
      {/* 预测折线 */}
      {predictionPath && (
        <path
          d={predictionPath}
          fill="none"
          stroke="#f59e0b"
          strokeWidth={2}
          strokeDasharray="4 2"
          data-testid="cost-chart-prediction"
        />
      )}
      {/* 数据点 */}
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={3}
          fill={p.type === 'history' ? '#3b82f6' : '#f59e0b'}
        />
      ))}
    </svg>
  );
}

export default CostPredictionPanel;
