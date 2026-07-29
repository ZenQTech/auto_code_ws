/**
 * # ============================================================
 * # ModelRouterStatsPanel - 模型路由成本统计 UI (v1.0.0 Cycle 21 G21-03)
 * # ============================================================
 * # 核心作用：可视化模型路由成本统计
 * # 主要功能：
 * #   1. 总成本/总 token/平均成本卡片
 * #   2. 模型成本排行
 * #   3. 任务类型成本分布
 * #   4. 成本趋势图（按天）
 * #   5. 24 小时成本分布
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-03 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getModelCostStats,
  type ModelCostStats,
  type ModelRoute,
  type RoutingMode,
  type TaskCategory,
} from '../utils/modelCostStats';

interface ModelRouterStatsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_LABELS: Record<TaskCategory, string> = {
  code_generation: '代码生成',
  code_review: '代码审查',
  debugging: '调试',
  documentation: '文档',
  translation: '翻译',
  explanation: '解释',
  refactoring: '重构',
  testing: '测试',
  analysis: '分析',
  brainstorm: '头脑风暴',
  unknown: '未知',
};

const MODE_LABELS: Record<RoutingMode, string> = {
  cost: '成本优先',
  balance: '平衡',
  intelligence: '能力优先',
  speed: '速度优先',
};

export function ModelRouterStatsPanel({ isOpen, onClose }: ModelRouterStatsPanelProps) {
  const collector = useMemo(() => getModelCostStats(), []);
  const [stats, setStats] = useState<ModelCostStats | null>(null);
  const [days, setDays] = useState(7);

  const refresh = useCallback(() => {
    setStats(collector.getStats());
  }, [collector]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
  }, [isOpen, refresh, days]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 模拟记录测试数据
  const handleSimulate = useCallback(() => {
    const models = ['claude-sonnet-4.5', 'gpt-5', 'gpt-4o', 'deepseek-v3.2', 'gemini-2.0-flash'];
    const categories: TaskCategory[] = ['code_generation', 'debugging', 'documentation', 'code_review', 'refactoring'];
    const modes: RoutingMode[] = ['cost', 'balance', 'intelligence'];
    for (let i = 0; i < 20; i++) {
      const model = models[Math.floor(Math.random() * models.length)] ?? 'claude-sonnet-4.5';
      const category = categories[Math.floor(Math.random() * categories.length)] ?? 'code_generation';
      const mode = modes[Math.floor(Math.random() * modes.length)] ?? 'balance';
      const route: ModelRoute = {
        model,
        category,
        complexity: 1 + Math.floor(Math.random() * 9),
        mode,
        reason: 'simulated',
        candidates: [],
        timestamp: Date.now() - Math.floor(Math.random() * days * 24 * 60 * 60 * 1000),
      };
      const costTable: Record<string, number> = {
        'claude-sonnet-4.5': 0.05,
        'gpt-5': 0.10,
        'gpt-4o': 0.03,
        'deepseek-v3.2': 0.005,
        'gemini-2.0-flash': 0.002,
      };
      collector.recordRoute({
        route,
        inputTokens: 500 + Math.floor(Math.random() * 2000),
        outputTokens: 200 + Math.floor(Math.random() * 1000),
        cost: costTable[model] ?? 0.05,
        success: Math.random() > 0.1,
        timestamp: route.timestamp,
      });
    }
    refresh();
  }, [collector, refresh, days]);

  if (!isOpen) return null;

  // 计算总成本用于百分比
  const totalCost = stats?.totalCost ?? 0;
  const maxDailyCost = Math.max(...(stats?.byDay.map((d) => d.cost) ?? [0]), 0.001);
  const maxHourlyCost = Math.max(...(stats?.byHour.map((h) => h.cost) ?? [0]), 0.001);

  return (
    <div
      data-testid="model-router-stats-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl w-[1100px] max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <div>
            <h2 className="text-xl font-semibold text-white">模型路由成本统计</h2>
            <p className="text-sm text-slate-400 mt-1">
              成本可视化、模型选型优化、预算规划
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              data-testid="stats-period"
              className="px-2 py-1 bg-surface-800 border border-surface-600 rounded text-sm text-white"
            >
              <option value={7}>最近 7 天</option>
              <option value={30}>最近 30 天</option>
              <option value={90}>最近 90 天</option>
            </select>
            <button
              onClick={handleSimulate}
              data-testid="simulate-data"
              className="px-3 py-1 bg-primary-500/20 hover:bg-primary-500/30 text-primary-300 text-sm rounded border border-primary-500/30"
            >
              模拟数据
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!stats || stats.totalDecisions === 0 ? (
            <div className="text-center text-slate-500 py-12">
              暂无数据。点击"模拟数据"生成测试数据。
            </div>
          ) : (
            <>
              {/* 概览卡片 */}
              <div className="grid grid-cols-4 gap-3" data-testid="stats-overview">
                <StatCard label="总决策数" value={stats.totalDecisions.toString()} unit="次" />
                <StatCard
                  label="总成本"
                  value={`$${stats.totalCost.toFixed(4)}`}
                  unit=""
                  highlight
                />
                <StatCard
                  label="平均成本"
                  value={`$${stats.avgCostPerDecision.toFixed(4)}`}
                  unit=""
                />
                <StatCard
                  label="总 Tokens"
                  value={`${(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()}`}
                  unit=""
                />
              </div>

              {/* 趋势指示 */}
              <div className="bg-surface-800/50 rounded-lg p-3 border border-surface-700">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-slate-400">成本趋势:</span>
                  <span className={`text-sm font-medium ${
                    stats.costTrend === 'up' ? 'text-red-300' :
                    stats.costTrend === 'down' ? 'text-green-300' :
                    'text-slate-300'
                  }`}>
                    {stats.costTrend === 'up' ? '↑ 上升' : stats.costTrend === 'down' ? '↓ 下降' : '→ 稳定'}
                    {stats.trendDelta !== 0 && ` (${stats.trendDelta.toFixed(1)}%)`}
                  </span>
                  <span className="text-xs text-slate-500">
                    Top Model: {stats.topModel || 'N/A'} · Top Category: {CATEGORY_LABELS[stats.topCategory]}
                  </span>
                </div>
              </div>

              {/* 模型排行 */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-2">模型成本排行</h3>
                <div className="space-y-1" data-testid="model-ranking">
                  {Object.values(stats.byModel)
                    .sort((a, b) => b.cost - a.cost)
                    .slice(0, 5)
                    .map((m) => {
                      const percent = totalCost > 0 ? (m.cost / totalCost) * 100 : 0;
                      return (
                        <div key={m.model} className="bg-surface-800/50 rounded p-2 border border-surface-700">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-white">{m.model}</span>
                            <span className="text-slate-300">${m.cost.toFixed(4)} ({m.count} 次)</span>
                          </div>
                          <div className="mt-1 h-1.5 bg-surface-900 rounded overflow-hidden">
                            <div
                              className="h-full bg-primary-500"
                              style={{ width: `${percent}%` }}
                            ></div>
                          </div>
                          <div className="mt-1 text-xs text-slate-500 flex gap-3">
                            <span>成功率: {(m.successRate * 100).toFixed(0)}%</span>
                            <span>平均复杂度: {m.avgComplexity.toFixed(1)}</span>
                            <span>单次均价: ${m.avgCostPerCall.toFixed(4)}</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* 任务类型分布 */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-2">任务类型成本分布</h3>
                <div className="grid grid-cols-2 gap-2" data-testid="category-distribution">
                  {Object.values(stats.byCategory)
                    .sort((a, b) => b.cost - a.cost)
                    .slice(0, 6)
                    .map((c) => (
                      <div key={c.category} className="bg-surface-800/50 rounded p-2 border border-surface-700">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-white">{CATEGORY_LABELS[c.category]}</span>
                          <span className="text-slate-300">${c.cost.toFixed(4)}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          {c.count} 次 · 推荐模型: {c.topModel || 'N/A'}
                        </div>
                      </div>
                    ))}
                </div>
              </div>

              {/* 每日成本趋势 */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-2">每日成本趋势</h3>
                <div className="bg-surface-800/30 rounded p-3 border border-surface-700" data-testid="daily-trend">
                  {stats.byDay.length === 0 ? (
                    <div className="text-slate-500 text-sm">无数据</div>
                  ) : (
                    <div className="space-y-1">
                      {stats.byDay.slice(-10).map((d) => (
                        <div key={d.date} className="flex items-center gap-2 text-xs">
                          <span className="w-20 text-slate-400">{d.date}</span>
                          <div className="flex-1 h-3 bg-surface-900 rounded overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-primary-500 to-purple-500"
                              style={{ width: `${(d.cost / maxDailyCost) * 100}%` }}
                            ></div>
                          </div>
                          <span className="w-20 text-right text-slate-300">${d.cost.toFixed(4)}</span>
                          <span className="w-12 text-right text-slate-500">{d.decisions}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 24 小时分布 */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-2">24 小时成本分布</h3>
                <div className="bg-surface-800/30 rounded p-3 border border-surface-700" data-testid="hourly-distribution">
                  <div className="flex items-end gap-1 h-20">
                    {stats.byHour.map((h) => (
                      <div
                        key={h.hour}
                        className="flex-1 bg-surface-700 rounded-t hover:bg-primary-500/50 transition"
                        style={{ height: `${(h.cost / maxHourlyCost) * 100}%`, minHeight: '2px' }}
                        title={`${h.hour}:00 - $${h.cost.toFixed(4)} (${h.decisions} 次)`}
                      ></div>
                    ))}
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 mt-1">
                    <span>0</span>
                    <span>6</span>
                    <span>12</span>
                    <span>18</span>
                    <span>23</span>
                  </div>
                </div>
              </div>

              {/* 模式分布 */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-2">路由模式分布</h3>
                <div className="grid grid-cols-4 gap-2">
                  {(Object.keys(stats.byMode) as RoutingMode[]).map((mode) => {
                    const m = stats.byMode[mode];
                    return (
                      <div key={mode} className="bg-surface-800/50 rounded p-2 border border-surface-700">
                        <div className="text-xs text-slate-400">{MODE_LABELS[mode]}</div>
                        <div className="text-sm text-white">{m.count} 次</div>
                        <div className="text-xs text-slate-500">${m.cost.toFixed(4)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, unit, highlight }: { label: string; value: string; unit?: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${
      highlight
        ? 'bg-primary-500/10 border-primary-500/30'
        : 'bg-surface-800/50 border-surface-700'
    }`}>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-white mt-1">{value}</div>
      {unit && <div className="text-xs text-slate-500 mt-1">{unit}</div>}
    </div>
  );
}

export default ModelRouterStatsPanel;
