/**
 * # ============================================================
 * # ModelRouterAdminPanel - 模型路由管理 UI (v1.0.0 Cycle 22 G22-04)
 * # ============================================================
 * # 核心作用：管理员级的路由策略管理界面
 * # 主要功能：
 * #   1. 团队/组策略 CRUD
 * #   2. 模型白/黑名单管理
 * #   3. 显示控制（隐藏/显示实际模型）
 * #   4. 团队默认模式设置
 * #   5. 路由历史 + 管理员报告
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 22 G22-04 初次创建
 * #   - 2026-07-29 | v1.0.1 | UI/UX 优化：渐变背景 + 渐入动画 + Esc 关闭
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getModelRouterEnhance,
  type TeamPolicy,
  type PolicyStatus,
  type RoutingMode,
  type AdminReport,
  type RouteHistoryEntry,
} from '../utils/modelRouterEnhance';

interface ModelRouterAdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const MODE_LABELS: Record<RoutingMode, string> = {
  cost: '成本优先',
  balance: '平衡',
  intelligence: '质量优先',
};

const STATUS_LABELS: Record<PolicyStatus, string> = {
  active: '激活',
  paused: '暂停',
  draft: '草稿',
};

const STATUS_COLORS: Record<PolicyStatus, string> = {
  active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  paused: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  draft: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const AVAILABLE_MODELS = [
  'claude-sonnet-4.5',
  'claude-opus-4',
  'gpt-5',
  'gpt-4o',
  'gpt-4-turbo',
  'deepseek-v3.2',
  'gemini-2.0-flash',
  'gemini-2.0-pro',
];

export function ModelRouterAdminPanel({ isOpen, onClose }: ModelRouterAdminPanelProps) {
  const enhancer = useMemo(() => getModelRouterEnhance(), []);
  const [policies, setPolicies] = useState<TeamPolicy[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [newTeamName, setNewTeamName] = useState('');
  const [adminReport, setAdminReport] = useState<AdminReport | null>(null);
  const [history, setHistory] = useState<RouteHistoryEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'policies' | 'history' | 'report'>('policies');
  const [error, setError] = useState<string | null>(null);

  // 刷新
  const refresh = useCallback(() => {
    setPolicies(enhancer.listTeamPolicies());
    setAdminReport(enhancer.generateAdminReport());
    setHistory(enhancer.getHistory({ limit: 50 }).reverse());
  }, [enhancer]);

  // 订阅
  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const off1 = enhancer.on('policy-created', refresh);
    const off2 = enhancer.on('policy-updated', refresh);
    const off3 = enhancer.on('policy-deleted', refresh);
    const off4 = enhancer.on('route-applied', refresh);
    const off5 = enhancer.on('route-blocked', refresh);
    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
    };
  }, [isOpen, enhancer, refresh]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 当前选中策略
  const currentPolicy = useMemo(
    () => policies.find((p) => p.teamId === selectedTeamId) || null,
    [policies, selectedTeamId]
  );

  // 创建策略
  const handleCreatePolicy = useCallback(() => {
    setError(null);
    if (!newTeamName.trim()) {
      setError('请输入团队名称');
      return;
    }
    try {
      const teamId = `team-${Date.now()}`;
      const policy = enhancer.createTeamPolicy(teamId, newTeamName.trim());
      setNewTeamName('');
      setSelectedTeamId(policy.teamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    }
  }, [enhancer, newTeamName]);

  // 删除策略
  const handleDeletePolicy = useCallback(
    (teamId: string) => {
      try {
        enhancer.deleteTeamPolicy(teamId);
        if (selectedTeamId === teamId) setSelectedTeamId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : '删除失败');
      }
    },
    [enhancer, selectedTeamId]
  );

  // 切换状态
  const handleToggleStatus = useCallback(
    (teamId: string) => {
      const policy = enhancer.getTeamPolicy(teamId);
      if (!policy) return;
      const next: PolicyStatus = policy.status === 'active' ? 'paused' : 'active';
      enhancer.setPolicyStatus(teamId, next);
    },
    [enhancer]
  );

  // 切换显示控制
  const handleToggleHide = useCallback(
    (teamId: string) => {
      const policy = enhancer.getTeamPolicy(teamId);
      if (!policy) return;
      enhancer.setHideActualModel(teamId, !policy.hideActualModel);
    },
    [enhancer]
  );

  // 切换模式
  const handleChangeMode = useCallback(
    (teamId: string, mode: RoutingMode) => {
      try {
        enhancer.setTeamMode(teamId, mode);
      } catch (err) {
        setError(err instanceof Error ? err.message : '设置模式失败');
      }
    },
    [enhancer]
  );

  // 添加白名单
  const handleAddWhitelist = useCallback(
    (teamId: string, model: string) => {
      try {
        enhancer.addToWhitelist(teamId, model);
      } catch (err) {
        setError(err instanceof Error ? err.message : '添加失败');
      }
    },
    [enhancer]
  );

  // 移除白名单
  const handleRemoveWhitelist = useCallback(
    (teamId: string, model: string) => {
      enhancer.removeFromWhitelist(teamId, model);
    },
    [enhancer]
  );

  // 添加黑名单
  const handleAddBlacklist = useCallback(
    (teamId: string, model: string) => {
      try {
        enhancer.addToBlacklist(teamId, model);
      } catch (err) {
        setError(err instanceof Error ? err.message : '添加失败');
      }
    },
    [enhancer]
  );

  // 移除黑名单
  const handleRemoveBlacklist = useCallback(
    (teamId: string, model: string) => {
      enhancer.removeFromBlacklist(teamId, model);
    },
    [enhancer]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="model-router-admin-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[90vw] max-w-6xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 flex items-center justify-center">
              <span className="text-white text-sm">🛡️</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">模型路由管理</h2>
              <p className="text-xs text-slate-400">团队策略 / 白黑名单 / 显示控制</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
            aria-label="关闭"
            data-testid="model-router-admin-close"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700 bg-surface-800/50">
          {(
            [
              { key: 'policies', label: '团队策略' },
              { key: 'history', label: '路由历史' },
              { key: 'report', label: '管理员报告' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              data-testid={`admin-tab-${t.key}`}
              className={`px-4 py-2 text-sm transition ${
                activeTab === t.key
                  ? 'text-white border-b-2 border-primary-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {error && (
            <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-sm max-w-md">
              {error}
              <button
                onClick={() => setError(null)}
                className="ml-2 text-rose-400 hover:text-rose-200"
              >
                ×
              </button>
            </div>
          )}

          {activeTab === 'policies' && (
            <div className="flex-1 flex overflow-hidden">
              {/* 左侧策略列表 */}
              <div className="w-72 border-r border-surface-700 flex flex-col">
                <div className="p-3 border-b border-surface-700">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreatePolicy()}
                      placeholder="新团队名称..."
                      data-testid="admin-team-name"
                      className="flex-1 px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-white text-sm"
                    />
                    <button
                      onClick={handleCreatePolicy}
                      data-testid="admin-create-policy"
                      className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded transition"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {policies.length === 0 ? (
                    <div className="p-4 text-center text-slate-500 text-sm">暂无团队策略</div>
                  ) : (
                    <ul className="divide-y divide-surface-700">
                      {policies.map((p) => (
                        <li key={p.teamId}>
                          <button
                            onClick={() => setSelectedTeamId(p.teamId)}
                            data-testid={`admin-team-${p.teamId}`}
                            className={`w-full px-3 py-3 text-left hover:bg-surface-800 transition ${
                              selectedTeamId === p.teamId ? 'bg-surface-800' : ''
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-sm font-medium text-white">{p.teamName}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLORS[p.status]}`}
                              >
                                {STATUS_LABELS[p.status]}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500">
                              模式: {MODE_LABELS[p.defaultMode]} ·{' '}
                              {p.hideActualModel ? '隐藏' : '显示'}实际模型
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* 右侧策略详情 */}
              <div className="flex-1 overflow-y-auto p-5">
                {!currentPolicy ? (
                  <div className="flex items-center justify-center h-full text-slate-500">
                    选择或创建团队策略
                  </div>
                ) : (
                  <PolicyDetail
                    policy={currentPolicy}
                    onDelete={() => handleDeletePolicy(currentPolicy.teamId)}
                    onToggleStatus={() => handleToggleStatus(currentPolicy.teamId)}
                    onToggleHide={() => handleToggleHide(currentPolicy.teamId)}
                    onChangeMode={(m) => handleChangeMode(currentPolicy.teamId, m)}
                    onAddWhitelist={(m) => handleAddWhitelist(currentPolicy.teamId, m)}
                    onRemoveWhitelist={(m) => handleRemoveWhitelist(currentPolicy.teamId, m)}
                    onAddBlacklist={(m) => handleAddBlacklist(currentPolicy.teamId, m)}
                    onRemoveBlacklist={(m) => handleRemoveBlacklist(currentPolicy.teamId, m)}
                  />
                )}
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="flex-1 overflow-y-auto p-5" data-testid="admin-history">
              {history.length === 0 ? (
                <div className="text-center text-slate-500 py-12">暂无路由历史</div>
              ) : (
                <div className="space-y-2">
                  {history.map((h) => (
                    <div
                      key={h.entryId}
                      className={`p-3 rounded-lg border ${
                        h.blocked
                          ? 'bg-rose-500/10 border-rose-500/30'
                          : 'bg-surface-800 border-surface-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm text-white">
                            实际: <span className="font-mono">{h.selectedModel}</span>
                            {h.displayModel !== h.selectedModel && (
                              <span className="text-slate-400 ml-2">
                                → 显示: <span className="font-mono">{h.displayModel}</span>
                              </span>
                            )}
                          </span>
                          {h.blocked && h.blockReason && (
                            <p className="text-xs text-rose-300 mt-1">{h.blockReason}</p>
                          )}
                        </div>
                        <div className="text-right text-xs text-slate-500">
                          <div>{h.teamId || '无团队'}</div>
                          <div>{new Date(h.timestamp).toLocaleTimeString()}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'report' && (
            <div className="flex-1 overflow-y-auto p-5" data-testid="admin-report">
              {adminReport ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-3">
                    <Stat label="总策略" value={adminReport.totalPolicies} />
                    <Stat label="激活策略" value={adminReport.activePolicies} color="text-emerald-400" />
                    <Stat label="总路由" value={adminReport.totalRoutes} />
                    <Stat label="阻止路由" value={adminReport.blockedRoutes} color="text-rose-400" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="隐藏路由" value={adminReport.hiddenRoutes} color="text-amber-400" />
                    <Stat label="TOP 模型数" value={adminReport.topModelsUsed.length} />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-slate-300 mb-2">TOP 使用模型</h3>
                    <div className="space-y-1">
                      {adminReport.topModelsUsed.slice(0, 5).map((m) => (
                        <div
                          key={m.model}
                          className="flex items-center justify-between p-2 bg-surface-800 border border-surface-700 rounded"
                        >
                          <span className="font-mono text-sm text-white">{m.model}</span>
                          <span className="text-sm text-slate-400">{m.count} 次</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center text-slate-500 py-12">无数据</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PolicyDetail({
  policy,
  onDelete,
  onToggleStatus,
  onToggleHide,
  onChangeMode,
  onAddWhitelist,
  onRemoveWhitelist,
  onAddBlacklist,
  onRemoveBlacklist,
}: {
  policy: TeamPolicy;
  onDelete: () => void;
  onToggleStatus: () => void;
  onToggleHide: () => void;
  onChangeMode: (m: RoutingMode) => void;
  onAddWhitelist: (m: string) => void;
  onRemoveWhitelist: (m: string) => void;
  onAddBlacklist: (m: string) => void;
  onRemoveBlacklist: (m: string) => void;
}) {
  const [modelToAdd, setModelToAdd] = useState('');
  const [listType, setListType] = useState<'whitelist' | 'blacklist'>('whitelist');

  const handleAdd = () => {
    if (!modelToAdd.trim()) return;
    if (listType === 'whitelist') onAddWhitelist(modelToAdd.trim());
    else onAddBlacklist(modelToAdd.trim());
    setModelToAdd('');
  };

  return (
    <div className="space-y-4" data-testid="admin-policy-detail">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{policy.teamName}</h3>
          <p className="text-xs text-slate-400 font-mono">{policy.teamId}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onToggleStatus}
            data-testid="admin-toggle-status"
            className={`px-3 py-1.5 text-xs rounded border ${STATUS_COLORS[policy.status]}`}
          >
            {STATUS_LABELS[policy.status]} (点击切换)
          </button>
          <button
            onClick={onDelete}
            data-testid="admin-delete-policy"
            className="px-3 py-1.5 text-xs bg-rose-600 hover:bg-rose-500 text-white rounded transition"
          >
            删除
          </button>
        </div>
      </div>

      {/* 默认模式 */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">默认路由模式</label>
        <div className="grid grid-cols-3 gap-2">
          {(['cost', 'balance', 'intelligence'] as RoutingMode[]).map((m) => (
            <button
              key={m}
              onClick={() => onChangeMode(m)}
              data-testid={`admin-mode-${m}`}
              className={`px-3 py-2 rounded-lg text-sm border transition ${
                policy.defaultMode === m
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'bg-surface-800 border-surface-600 text-slate-400 hover:border-surface-500'
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {/* 显示控制 */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={policy.hideActualModel}
            onChange={onToggleHide}
            data-testid="admin-toggle-hide"
            className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500"
          />
          <span className="text-sm text-slate-300">隐藏实际模型（对用户显示为通用名）</span>
        </label>
      </div>

      {/* 白/黑名单 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setListType('whitelist')}
            data-testid="admin-list-type-whitelist"
            className={`px-3 py-1 text-xs rounded ${
              listType === 'whitelist' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-surface-700 text-slate-400'
            }`}
          >
            白名单 ({policy.whitelist.length})
          </button>
          <button
            onClick={() => setListType('blacklist')}
            data-testid="admin-list-type-blacklist"
            className={`px-3 py-1 text-xs rounded ${
              listType === 'blacklist' ? 'bg-rose-500/20 text-rose-300' : 'bg-surface-700 text-slate-400'
            }`}
          >
            黑名单 ({policy.blacklist.length})
          </button>
        </div>
        <div className="flex gap-2 mb-2">
          <input
            type="text"
            value={modelToAdd}
            onChange={(e) => setModelToAdd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="模型 ID..."
            className="flex-1 px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-white text-sm"
          />
          <button
            onClick={handleAdd}
            data-testid="admin-add-model"
            className="px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-xs rounded transition"
          >
            添加
          </button>
        </div>
        <div className="text-xs text-slate-500 mb-2">预设:</div>
        <div className="flex flex-wrap gap-1 mb-2">
          {AVAILABLE_MODELS.map((m) => {
            const inList =
              listType === 'whitelist' ? policy.whitelist.includes(m) : policy.blacklist.includes(m);
            return (
              <button
                key={m}
                onClick={() => {
                  if (!inList) {
                    setModelToAdd(m);
                    handleAdd();
                  }
                }}
                disabled={inList}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  inList
                    ? 'bg-surface-700 text-slate-500 cursor-not-allowed'
                    : 'bg-surface-800 text-slate-300 hover:bg-surface-700'
                }`}
              >
                {m}
              </button>
            );
          })}
        </div>
        <div className="space-y-1" data-testid={`admin-${listType}-list`}>
          {(listType === 'whitelist' ? policy.whitelist : policy.blacklist).length === 0 ? (
            <div className="text-xs text-slate-500">空</div>
          ) : (
            (listType === 'whitelist' ? policy.whitelist : policy.blacklist).map((m) => (
              <div
                key={m}
                className="flex items-center justify-between p-2 bg-surface-800 border border-surface-700 rounded"
              >
                <span className="font-mono text-sm text-white">{m}</span>
                <button
                  onClick={() =>
                    listType === 'whitelist' ? onRemoveWhitelist(m) : onRemoveBlacklist(m)
                  }
                  className="text-xs text-rose-400 hover:text-rose-300"
                >
                  移除
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color || 'text-white'}`}>{value}</div>
    </div>
  );
}

export default ModelRouterAdminPanel;
