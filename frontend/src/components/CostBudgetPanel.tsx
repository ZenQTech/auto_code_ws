/**
 * # ============================================================
 * # Cost Budget Panel - 成本预算 UI (v1.0.0 Cycle 28 G28-02)
 * # ============================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { getDefaultCostBudgetEngine } from '../utils/costBudgetEngine';
import { BudgetLimit, ModelSpec } from '../utils/costBudgetEngine';

interface CostBudgetPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'overview' | 'budgets' | 'models';

export const CostBudgetPanel: React.FC<CostBudgetPanelProps> = ({ isOpen, onClose }) => {
  const engine = useMemo(() => getDefaultCostBudgetEngine(), []);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [budgets, setBudgets] = useState<BudgetLimit[]>([]);
  const [models, setModels] = useState<ModelSpec[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [newLimit, setNewLimit] = useState('1.0');

  useEffect(() => {
    if (!isOpen) return;
    setBudgets(engine.listBudgets());
    setModels(engine.listModels());
    setTotalCost(engine.getTotalCost());
  }, [isOpen, refreshKey, engine]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleCreateBudget = (level: 'request' | 'agent' | 'daily') => {
    engine.createBudget({ level, limitUsd: parseFloat(newLimit) });
    refresh();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="cost-budget-panel">
      <div className="bg-white rounded-lg shadow-xl w-[900px] max-w-[95vw] h-[600px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">💰</span>
            <h2 className="text-lg font-semibold">成本预算 (Cost Budget)</h2>
            <span className="text-xs text-gray-500">fallbackModel + 3层预算</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" data-testid="cost-budget-close">✕</button>
        </div>

        <div className="flex border-b px-5">
          {(['overview', 'budgets', 'models'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 text-sm border-b-2 ${activeTab === t ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500'}`}
              data-testid={`cost-budget-tab-${t}`}
            >
              {t === 'overview' && '总览'}
              {t === 'budgets' && '预算'}
              {t === 'models' && '模型'}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-5">
          {activeTab === 'overview' && (
            <div className="space-y-4" data-testid="cost-budget-overview">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="总成本" value={`$${totalCost.toFixed(4)}`} color="green" />
                <Stat label="预算数" value={budgets.length} />
                <Stat label="模型数" value={models.length} />
              </div>
              <div className="border rounded p-3">
                <h3 className="text-sm font-semibold mb-2">Fallback 链</h3>
                <div className="text-xs text-gray-600 space-y-1">
                  <div>Primary: <code className="text-indigo-600">{engine.getFallbackChain().primary}</code></div>
                  <div>Fallbacks: {engine.getFallbackChain().fallbacks.map((f) => (
                    <code key={f} className="ml-1 text-indigo-600">{f}</code>
                  ))}</div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'budgets' && (
            <div className="space-y-3" data-testid="cost-budget-budgets">
              <div className="flex gap-2 items-end">
                <div>
                  <label className="text-xs text-gray-500">新建预算限额 (USD)</label>
                  <input
                    type="number"
                    value={newLimit}
                    onChange={(e) => setNewLimit(e.target.value)}
                    className="block border rounded px-2 py-1 text-sm w-32"
                    data-testid="cost-budget-new-limit"
                  />
                </div>
                <button onClick={() => handleCreateBudget('request')} className="px-3 py-1 bg-green-500 text-white rounded text-sm" data-testid="cost-budget-create-request">+ Request</button>
                <button onClick={() => handleCreateBudget('daily')} className="px-3 py-1 bg-green-500 text-white rounded text-sm" data-testid="cost-budget-create-daily">+ Daily</button>
              </div>
              <div className="space-y-2">
                {budgets.map((b, i) => {
                  const percent = (b.usedUsd / b.limitUsd) * 100;
                  return (
                    <div key={i} className="border rounded p-3" data-testid={`cost-budget-item-${b.level}`}>
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-sm font-semibold">{b.level}</span>
                          <span className="text-xs text-gray-500 ml-2">{b.enforcement}</span>
                        </div>
                        <div className="text-sm">
                          <span className="font-mono">${b.usedUsd.toFixed(4)}</span>
                          <span className="text-gray-500"> / ${b.limitUsd.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="mt-2 h-2 bg-gray-100 rounded overflow-hidden">
                        <div
                          className={`h-full ${percent > 90 ? 'bg-red-500' : percent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${Math.min(100, percent)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'models' && (
            <div className="space-y-2" data-testid="cost-budget-models">
              {models.map((m) => (
                <div key={m.id} className="border rounded p-3 flex justify-between items-center">
                  <div>
                    <div className="font-semibold text-sm">{m.name}</div>
                    <div className="text-xs text-gray-500 font-mono">{m.id}</div>
                  </div>
                  <div className="text-right text-xs">
                    <div>${m.inputCostPer1M}/1M in</div>
                    <div>${m.outputCostPer1M}/1M out</div>
                    <div className="text-gray-500">{(m.maxContext / 1000).toFixed(0)}K ctx</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color }) => (
  <div className="border rounded p-3 text-center">
    <div className="text-xs text-gray-500">{label}</div>
    <div className={`text-2xl font-bold ${color === 'green' ? 'text-green-600' : 'text-gray-700'}`}>{value}</div>
  </div>
);

export default CostBudgetPanel;
