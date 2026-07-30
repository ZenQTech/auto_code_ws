/**
 * CostThresholdAlertPanel - 成本阈值告警面板 (v1.0.0 Cycle 30 G30-01)
 *
 * 核心作用：实现 Claude Code Admin Console 风格的成本阈值告警 UI
 * 三个 Tab：阈值配置 / 告警历史 / 提额申请
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  getDefaultCostThresholdAlertEngine,
  type ScopeRef,
  type ThresholdConfig,
  type SpendAlert,
  type QuotaRequest,
  type NotificationConfig,
} from '../utils/costThresholdAlertEngine';

interface CostThresholdAlertPanelProps {
  isOpen: boolean;
  onClose: () => void;
  standalone?: boolean;
}

type Tab = 'thresholds' | 'alerts' | 'requests';

const DEFAULT_THRESHOLDS: ThresholdConfig = {
  warning: 75,
  critical: 90,
  blocked: 100,
};

const SCOPE_PRESETS: Array<{ label: string; value: ScopeRef }> = [
  { label: '组织 (Organization)', value: { scope: 'org', scopeId: 'org-default' } },
  { label: '用户 (User)', value: { scope: 'user', scopeId: 'user-default' } },
  { label: '团队 (Team)', value: { scope: 'team', scopeId: 'team-default' } },
];

export const CostThresholdAlertPanel: React.FC<CostThresholdAlertPanelProps> = ({ isOpen, onClose, standalone = false }) => {
  const engine = useMemo(() => getDefaultCostThresholdAlertEngine(), []);
  const [activeTab, setActiveTab] = useState<Tab>('thresholds');
  const [scopeIdx, setScopeIdx] = useState(0);
  const [budget, setBudget] = useState<number>(100);
  const [thresholds, setThresholds] = useState<ThresholdConfig>(DEFAULT_THRESHOLDS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [alerts, setAlerts] = useState<SpendAlert[]>([]);
  const [requests, setRequests] = useState<QuotaRequest[]>([]);
  const [simulateAmount, setSimulateAmount] = useState<number>(50);
  const [showCreateRequest, setShowCreateRequest] = useState(false);
  const [requestedBudget, setRequestedBudget] = useState<number>(200);
  const [requestReason, setRequestReason] = useState<string>('');

  const refresh = () => setRefreshKey((k) => k + 1);
  const scope = SCOPE_PRESETS[scopeIdx].value;

  useEffect(() => {
    if (!isOpen) return;
    const t = engine.getThresholds(scope);
    setThresholds(t);
    setBudget(engine.getBudget(scope));
    setAlerts(engine.getAllAlerts().filter((a) => a.scope.scope === scope.scope && a.scope.scopeId === scope.scopeId));
    setRequests(engine.listQuotaRequests().filter((r) => r.scope.scope === scope.scope && r.scope.scopeId === scope.scopeId));
  }, [isOpen, scopeIdx, refreshKey, engine, scope]);

  const handleSaveThresholds = () => {
    engine.setThresholds(scope, thresholds);
    engine.setBudget(scope, budget);
    refresh();
  };

  const handleSimulateSpend = () => {
    engine.recordSpend(scope, simulateAmount, 'simulated');
    engine.checkThresholds(scope);
    refresh();
  };

  const handleAcknowledge = (alertId: string) => {
    engine.acknowledge(alertId, 'current-user');
    refresh();
  };

  const handleResolve = (alertId: string) => {
    const alert = engine.getAlert(alertId);
    if (alert) {
      const config: NotificationConfig = {
        channels: ['email'],
        emailRecipients: ['current-user'],
      };
      engine.sendNotification(alert, config);
    }
    refresh();
  };

  const handleCreateRequest = () => {
    if (!requestReason.trim()) return;
    try {
      engine.requestQuotaIncrease({
        requester: 'current-user',
        scope,
        requestedBudget,
        reason: requestReason,
      });
      setShowCreateRequest(false);
      setRequestReason('');
    } catch (e) {
      // requestedBudget 必须大于当前预算
    }
    refresh();
  };

  const handleApproveRequest = (reqId: string) => {
    engine.reviewQuotaRequest(reqId, 'approved', 'admin-user', 'approved via panel');
    engine.applyApprovedRequest(reqId);
    refresh();
  };

  const handleDenyRequest = (reqId: string) => {
    engine.reviewQuotaRequest(reqId, 'denied', 'admin-user', 'denied via panel');
    refresh();
  };

  const isBlocked = engine.isBlocked(scope);

  if (!isOpen) return null;

  const panelBody = (
    <div className={`bg-white rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col ${standalone ? '' : ''}`}>
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-2xl">💰</span>
          <h2 className="text-lg font-semibold text-gray-800">成本阈值告警</h2>
          {isBlocked && (
            <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full font-medium">
              已阻断
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-800 text-xl">
          ✕
        </button>
      </div>

      <div className="flex border-b border-gray-200 px-4">
        {[
          { key: 'thresholds', label: '阈值配置' },
          { key: 'alerts', label: `告警历史 (${alerts.length})` },
          { key: 'requests', label: `提额申请 (${requests.length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 ${
              activeTab === tab.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'thresholds' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">作用域</label>
              <select
                value={scopeIdx}
                onChange={(e) => setScopeIdx(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                {SCOPE_PRESETS.map((s, i) => (
                  <option key={i} value={i}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                预算上限 (USD): <span className="text-blue-600 font-bold">${budget.toFixed(2)}</span>
              </label>
              <input
                type="range"
                min="10"
                max="1000"
                step="10"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="w-full"
              />
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(Number(e.target.value))}
                className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 bg-yellow-50 rounded border border-yellow-200">
                <label className="block text-sm font-medium text-yellow-700 mb-1">⚠️ Warning</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={thresholds.warning}
                  onChange={(e) => setThresholds({ ...thresholds, warning: Number(e.target.value) })}
                  className="w-full px-2 py-1 border border-yellow-300 rounded text-sm"
                />
                <span className="text-xs text-yellow-600">%</span>
              </div>
              <div className="p-3 bg-orange-50 rounded border border-orange-200">
                <label className="block text-sm font-medium text-orange-700 mb-1">🔥 Critical</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={thresholds.critical}
                  onChange={(e) => setThresholds({ ...thresholds, critical: Number(e.target.value) })}
                  className="w-full px-2 py-1 border border-orange-300 rounded text-sm"
                />
                <span className="text-xs text-orange-600">%</span>
              </div>
              <div className="p-3 bg-red-50 rounded border border-red-200">
                <label className="block text-sm font-medium text-red-700 mb-1">🚫 Blocked</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={thresholds.blocked}
                  onChange={(e) => setThresholds({ ...thresholds, blocked: Number(e.target.value) })}
                  className="w-full px-2 py-1 border border-red-300 rounded text-sm"
                />
                <span className="text-xs text-red-600">%</span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveThresholds}
                className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600"
              >
                💾 保存配置
              </button>
            </div>

            <div className="mt-4 p-3 bg-gray-50 rounded border border-gray-200">
              <h3 className="text-sm font-medium text-gray-700 mb-2">🧪 模拟消费 (测试用)</h3>
              <div className="flex gap-2 items-center">
                <input
                  type="number"
                  value={simulateAmount}
                  onChange={(e) => setSimulateAmount(Number(e.target.value))}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <button
                  onClick={handleSimulateSpend}
                  className="px-4 py-2 bg-green-500 text-white text-sm rounded hover:bg-green-600"
                >
                  记录消费
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                预算: ${budget}，消费 ${simulateAmount} = {budget > 0 ? (simulateAmount / budget * 100).toFixed(1) : '0'}%
              </p>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-2">
            {alerts.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">暂无告警</p>
            ) : (
              [...alerts]
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((a) => (
                  <div
                    key={a.id}
                    className={`p-3 rounded border ${
                      a.level === 'blocked'
                        ? 'bg-red-50 border-red-300'
                        : a.level === 'critical'
                        ? 'bg-orange-50 border-orange-300'
                        : 'bg-yellow-50 border-yellow-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-xs font-medium rounded ${
                              a.level === 'blocked'
                                ? 'bg-red-200 text-red-800'
                                : a.level === 'critical'
                                ? 'bg-orange-200 text-orange-800'
                                : 'bg-yellow-200 text-yellow-800'
                            }`}
                          >
                            {a.level.toUpperCase()}
                          </span>
                          <span className="text-sm font-medium text-gray-800">{a.scope.scopeId}</span>
                          {a.acknowledged && <span className="text-xs text-blue-600">已确认 by {a.acknowledgedBy}</span>}
                        </div>
                        <p className="text-sm text-gray-700 mt-1">{a.message}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          ${a.currentSpend.toFixed(2)} / ${a.budget.toFixed(2)} ({(a.utilization * 100).toFixed(1)}%)
                          · {new Date(a.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {!a.acknowledged && (
                          <button
                            onClick={() => handleAcknowledge(a.id)}
                            className="px-2 py-1 text-xs bg-white border border-gray-300 rounded hover:bg-gray-50"
                          >
                            确认
                          </button>
                        )}
                        <button
                          onClick={() => handleResolve(a.id)}
                          className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                        >
                          通知
                        </button>
                      </div>
                    </div>
                  </div>
                ))
            )}
          </div>
        )}

        {activeTab === 'requests' && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                onClick={() => setShowCreateRequest(true)}
                className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                + 新建申请
              </button>
            </div>

            {showCreateRequest && (
              <div className="p-3 bg-blue-50 rounded border border-blue-200">
                <h3 className="text-sm font-medium text-gray-800 mb-2">新建提额申请</h3>
                <div className="space-y-2">
                  <div>
                    <label className="text-xs text-gray-600">申请预算 (USD，必须 &gt; ${budget})</label>
                    <input
                      type="number"
                      value={requestedBudget}
                      onChange={(e) => setRequestedBudget(Number(e.target.value))}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600">申请原因</label>
                    <textarea
                      value={requestReason}
                      onChange={(e) => setRequestReason(e.target.value)}
                      rows={3}
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                      placeholder="请详细说明需要提额的原因..."
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateRequest}
                      className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                    >
                      提交
                    </button>
                    <button
                      onClick={() => setShowCreateRequest(false)}
                      className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            )}

            {requests.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">暂无申请</p>
            ) : (
              [...requests]
                .sort((a, b) => b.reviewedAt! - a.reviewedAt!)
                .map((r) => (
                  <div key={r.id} className="p-3 bg-white rounded border border-gray-200">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 text-xs rounded font-medium ${
                              r.status === 'approved' || r.status === 'applied'
                                ? 'bg-green-100 text-green-700'
                                : r.status === 'denied'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {r.status.toUpperCase()}
                          </span>
                          <span className="text-sm font-medium text-gray-800">
                            ${r.currentBudget} → ${r.requestedBudget}
                          </span>
                          <span className="text-xs text-gray-500">by {r.requester}</span>
                        </div>
                        <p className="text-sm text-gray-700 mt-1">{r.reason}</p>
                        {r.reviewedAt && (
                          <p className="text-xs text-gray-500 mt-1">
                            {new Date(r.reviewedAt).toLocaleString()}
                            {r.reviewer && ` · reviewed by ${r.reviewer}`}
                          </p>
                        )}
                      </div>
                      {r.status === 'pending' && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleApproveRequest(r.id)}
                            className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                          >
                            批准
                          </button>
                          <button
                            onClick={() => handleDenyRequest(r.id)}
                            className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                          >
                            拒绝
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
            )}
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500 flex justify-between">
        <span>告警引擎 v1.0.0 · Cycle 30 G30-01</span>
        <span>💡 多级阈值 · 跨级升级 · 强制阻断</span>
      </div>
    </div>
  );

  if (standalone) return panelBody;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      {panelBody}
    </div>
  );
};

export default CostThresholdAlertPanel;
