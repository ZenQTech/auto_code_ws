/**
 * # ============================================================
 * # GoalAutomationPanel - Goal 自动轮转 + 多 Agent 委派 UI
 * # ============================================================
 * # 核心作用：提供 Goal Automation 3 大子系统的可视化操作界面
 * #   1. Auto-Turn 标签：注册/暂停/触发轮转 + 历史查看
 * #   2. Agents 标签：注册 Agent + 状态管理 + 负载分布
 * #   3. Delegations 标签：委派任务 + 完成回调 + 历史审计
 * # 运行流程：
 * #   1. 组件挂载时自动拉取 stats + 活跃 Goal + Agent 列表
 * #   2. 用户操作触发对应 API 调用，loading 状态控制防重入
 * #   3. 操作完成后调用 refreshAll 刷新全局数据
 * # 输入参数：
 * #   - onClose?: 关闭回调（可选）
 * # 输出结果：完整的 Goal Automation 操作面板
 * # 修改记录：
 * #   - 2026-07-28 | v6.32.0 | Cycle 14 P1-4 初始版本
 * # ============================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  useGoalAutomationApi,
  AgentSpec,
  AgentRole,
  AgentStatus,
  RiskLevel,
  ACType,
  TurnStrategy,
  TurnTrigger,
  ActiveGoal,
  TurnRecord,
  DelegationResult,
  GoalAutomationStats,
  LoadDistribution,
  STRATEGY_OPTIONS,
  ROLE_OPTIONS,
  RISK_OPTIONS,
  STATE_OPTIONS,
  DECISION_OPTIONS,
  AC_TYPE_OPTIONS,
} from '../hooks/useGoalAutomationApi';

// ============================================================
// 类型
// ============================================================

type Tab = 'auto-turn' | 'agents' | 'delegations';

interface GoalAutomationPanelProps {
  onClose?: () => void;
  defaultUser?: string;
  defaultProject?: string;
}

const TABS: Array<{ key: Tab; label: string; icon: string; color: string }> = [
  { key: 'auto-turn', label: 'Auto-Turn 轮转', icon: '🔄', color: 'blue' },
  { key: 'agents', label: 'Agent 注册表', icon: '🤖', color: 'violet' },
  { key: 'delegations', label: '委派任务', icon: '📤', color: 'pink' },
];

// ============================================================
// 工具函数
// ============================================================

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function classNames(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(' ');
}

// ============================================================
// 子组件：Stats Bar
// ============================================================

interface StatsBarProps {
  stats: GoalAutomationStats | null;
  loading: boolean;
}

const StatsBar: React.FC<StatsBarProps> = ({ stats, loading }) => {
  if (loading) {
    return (
      <div className="text-sm text-gray-500 px-4 py-2">加载统计中...</div>
    );
  }
  if (!stats) {
    return <div className="text-sm text-gray-500 px-4 py-2">暂无统计数据</div>;
  }
  const at = stats.auto_turn;
  const dl = stats.delegation;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 px-4 py-3 bg-gradient-to-r from-blue-50 via-violet-50 to-pink-50 border-b border-gray-200">
      <Stat label="活跃 Goal" value={at.total_goals} icon="🎯" color="blue" />
      <Stat label="轮转总数" value={at.total_turns} icon="🔄" color="violet" />
      <Stat label="已通过 AC" value={at.passed_acs} icon="✅" color="green" />
      <Stat label="失败 AC" value={at.failed_acs} icon="❌" color="red" />
      <Stat label="已注册 Agent" value={dl.total_agents} icon="🤖" color="purple" />
      <Stat label="委派总数" value={dl.total_delegations} icon="📤" color="pink" />
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number; icon: string; color: string }> = ({ label, value, icon, color }) => {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50',
    violet: 'text-violet-600 bg-violet-50',
    green: 'text-green-600 bg-green-50',
    red: 'text-red-600 bg-red-50',
    purple: 'text-purple-600 bg-purple-50',
    pink: 'text-pink-600 bg-pink-50',
  };
  return (
    <div className={classNames('rounded-md px-3 py-2 flex items-center gap-2', colorMap[color] || 'text-gray-600 bg-gray-50')}>
      <span className="text-lg">{icon}</span>
      <div>
        <div className="text-xs text-gray-600">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );
};

// ============================================================
// 子组件：Auto-Turn Tab
// ============================================================

interface AutoTurnTabProps {
  api: ReturnType<typeof useGoalAutomationApi>;
  goals: ActiveGoal[];
  refresh: () => Promise<void>;
}

const AutoTurnTab: React.FC<AutoTurnTabProps> = ({ api, goals, refresh }) => {
  const [showRegister, setShowRegister] = useState(false);
  const [history, setHistory] = useState<TurnRecord[]>([]);
  const [historyGoalId, setHistoryGoalId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 注册表单
  const [formGoalId, setFormGoalId] = useState('');
  const [formStrategy, setFormStrategy] = useState<TurnStrategy>('standard');
  const [formMaxTurns, setFormMaxTurns] = useState(100);
  const [formInterval, setFormInterval] = useState(30);
  const [formAutoVerify, setFormAutoVerify] = useState(true);
  const [formAutoProgress, setFormAutoProgress] = useState(true);

  const handleLoadHistory = useCallback(
    async (goalId: string) => {
      try {
        setErrorMsg(null);
        const r = await api.getTurnHistory(goalId, 20);
        setHistory(r.history);
        setHistoryGoalId(goalId);
      } catch (e: any) {
        setErrorMsg(e?.message || '加载历史失败');
      }
    },
    [api],
  );

  const handleRegister = useCallback(async () => {
    if (!formGoalId.trim()) {
      setErrorMsg('Goal ID 不能为空');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.registerGoalConfig({
        goal_id: formGoalId.trim(),
        strategy: formStrategy,
        interval_seconds: formInterval,
        max_turns: formMaxTurns,
        auto_verify: formAutoVerify,
        auto_progress: formAutoProgress,
        triggers: ['manual' as TurnTrigger],
        enabled: true,
      });
      setShowRegister(false);
      setFormGoalId('');
      await refresh();
    } catch (e: any) {
      setErrorMsg(e?.message || '注册失败');
    } finally {
      setBusy(false);
    }
  }, [api, formGoalId, formStrategy, formMaxTurns, formInterval, formAutoVerify, formAutoProgress, refresh]);

  const handleTrigger = useCallback(
    async (goalId: string) => {
      setBusy(true);
      setErrorMsg(null);
      try {
        const r = await api.triggerTurn(goalId, 'manual', 2);
        if (r.turn_record.state === 'failed') {
          setErrorMsg(`轮转失败: ${r.turn_record.error || '未知错误'}`);
        }
        await refresh();
        await handleLoadHistory(goalId);
      } catch (e: any) {
        setErrorMsg(e?.message || '触发失败');
      } finally {
        setBusy(false);
      }
    },
    [api, refresh, handleLoadHistory],
  );

  const handleControl = useCallback(
    async (action: 'pause' | 'resume' | 'stop' | 'unregister', goalId: string) => {
      setBusy(true);
      setErrorMsg(null);
      try {
        if (action === 'pause') await api.pauseGoal(goalId);
        else if (action === 'resume') await api.resumeGoal(goalId);
        else if (action === 'stop') await api.stopGoal(goalId);
        else await api.unregisterGoalConfig(goalId);
        await refresh();
      } catch (e: any) {
        setErrorMsg(e?.message || `${action} 失败`);
      } finally {
        setBusy(false);
      }
    },
    [api, refresh],
  );

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {errorMsg && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          ⚠️ {errorMsg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">活跃 Goal 列表</h3>
        <button
          onClick={() => setShowRegister(!showRegister)}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors"
        >
          {showRegister ? '取消' : '+ 注册 Goal'}
        </button>
      </div>

      {showRegister && (
        <div className="rounded-md bg-blue-50 border border-blue-200 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Goal ID</label>
              <input
                type="text"
                value={formGoalId}
                onChange={(e) => setFormGoalId(e.target.value)}
                placeholder="goal_xxx"
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">策略</label>
              <select
                value={formStrategy}
                onChange={(e) => setFormStrategy(e.target.value as TurnStrategy)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {STRATEGY_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} - {s.description}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">最大轮转次数</label>
              <input
                type="number"
                min={1}
                value={formMaxTurns}
                onChange={(e) => setFormMaxTurns(parseInt(e.target.value, 10) || 100)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">轮转间隔 (秒)</label>
              <input
                type="number"
                min={1}
                value={formInterval}
                onChange={(e) => setFormInterval(parseInt(e.target.value, 10) || 30)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-700">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={formAutoVerify}
                onChange={(e) => setFormAutoVerify(e.target.checked)}
                className="rounded"
              />
              自动验证
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={formAutoProgress}
                onChange={(e) => setFormAutoProgress(e.target.checked)}
                className="rounded"
              />
              自动进度
            </label>
          </div>
          <button
            onClick={handleRegister}
            disabled={busy}
            className="w-full py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {busy ? '注册中...' : '注册'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {goals.length === 0 ? (
          <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
            暂无活跃 Goal。点击"注册 Goal"开始。
          </div>
        ) : (
          goals.map((g) => {
            const stateOpt = STATE_OPTIONS[g.state] || STATE_OPTIONS.idle;
            const stratOpt = STRATEGY_OPTIONS.find((s) => s.value === g.strategy) || STRATEGY_OPTIONS[1];
            return (
              <div key={g.goal_id} className="rounded-md border border-gray-200 bg-white p-3 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-mono text-gray-800">{g.goal_id}</span>
                      <span className={classNames('text-xs px-2 py-0.5 rounded-full', stateOpt.bgColor, stateOpt.color)}>
                        {stateOpt.label}
                      </span>
                      <span className={classNames('text-xs', stratOpt.color)}>{stratOpt.label}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      轮转 {g.turn_count}/{g.max_turns} · 间隔 {g.interval_seconds}s ·
                      最后轮转 {formatDate(g.last_turn_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleTrigger(g.goal_id)}
                      disabled={busy}
                      className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors disabled:opacity-50"
                      title="触发单次轮转"
                    >
                      ▶ 触发
                    </button>
                    {g.state !== 'paused' && g.state !== 'stopped' && (
                      <button
                        onClick={() => handleControl('pause', g.goal_id)}
                        disabled={busy}
                        className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition-colors disabled:opacity-50"
                        title="暂停"
                      >
                        ⏸ 暂停
                      </button>
                    )}
                    {g.state === 'paused' && (
                      <button
                        onClick={() => handleControl('resume', g.goal_id)}
                        disabled={busy}
                        className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors disabled:opacity-50"
                        title="恢复"
                      >
                        ▶ 恢复
                      </button>
                    )}
                    {g.state !== 'stopped' && (
                      <button
                        onClick={() => handleControl('stop', g.goal_id)}
                        disabled={busy}
                        className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
                        title="停止"
                      >
                        ⏹ 停止
                      </button>
                    )}
                    <button
                      onClick={() => handleLoadHistory(g.goal_id)}
                      disabled={busy}
                      className="px-2 py-1 text-xs bg-violet-100 text-violet-700 rounded hover:bg-violet-200 transition-colors disabled:opacity-50"
                      title="查看历史"
                    >
                      📜 历史
                    </button>
                    <button
                      onClick={() => handleControl('unregister', g.goal_id)}
                      disabled={busy}
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:opacity-50"
                      title="注销"
                    >
                      🗑 注销
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {historyGoalId && history.length > 0 && (
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <h4 className="text-sm font-semibold text-gray-800 mb-2">
            📜 轮转历史：<span className="font-mono">{historyGoalId}</span>
          </h4>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {history.map((h) => {
              const stateOpt = STATE_OPTIONS[h.state] || STATE_OPTIONS.idle;
              return (
                <div key={h.turn_id} className="text-xs flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-b-0">
                  <span className="font-mono text-gray-500">#{h.turn_number}</span>
                  <span className={classNames('px-1.5 py-0.5 rounded text-xs', stateOpt.bgColor, stateOpt.color)}>
                    {stateOpt.label}
                  </span>
                  <span className="text-gray-600">通过 {h.ac_passed.length} / 处理 {h.ac_processed.length}</span>
                  <span className="text-gray-500">· {h.duration_ms}ms</span>
                  {h.error && <span className="text-red-500 truncate">· {h.error}</span>}
                  <span className="ml-auto text-gray-400">{formatDate(h.finished_at)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// 子组件：Agents Tab
// ============================================================

interface AgentsTabProps {
  api: ReturnType<typeof useGoalAutomationApi>;
  agents: AgentSpec[];
  load: LoadDistribution | null;
  refresh: () => Promise<void>;
}

const AgentsTab: React.FC<AgentsTabProps> = ({ api, agents, load, refresh }) => {
  const [showRegister, setShowRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<AgentRole | ''>('');
  const [filterStatus, setFilterStatus] = useState<AgentStatus | ''>('');

  // 表单
  const [formAgentId, setFormAgentId] = useState('');
  const [formRole, setFormRole] = useState<AgentRole>('implementer');
  const [formName, setFormName] = useState('');
  const [formCaps, setFormCaps] = useState('python, fastapi');
  const [formRisks, setFormRisks] = useState<RiskLevel[]>(['low', 'medium']);
  const [formMaxLoad, setFormMaxLoad] = useState(5);

  const handleRegister = useCallback(async () => {
    if (!formAgentId.trim() || !formName.trim()) {
      setErrorMsg('Agent ID 和 Name 不能为空');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      await api.registerAgent({
        agent_id: formAgentId.trim(),
        role: formRole,
        name: formName.trim(),
        capabilities: formCaps.split(',').map((s) => s.trim()).filter(Boolean),
        risk_levels: formRisks,
        max_load: formMaxLoad,
        metadata: {},
      });
      setShowRegister(false);
      setFormAgentId('');
      setFormName('');
      await refresh();
    } catch (e: any) {
      setErrorMsg(e?.message || '注册失败');
    } finally {
      setBusy(false);
    }
  }, [api, formAgentId, formRole, formName, formCaps, formRisks, formMaxLoad, refresh]);

  const handleUnregister = useCallback(
    async (agentId: string) => {
      if (!window.confirm(`确认注销 Agent ${agentId}？`)) return;
      setBusy(true);
      setErrorMsg(null);
      try {
        await api.unregisterAgent(agentId);
        await refresh();
      } catch (e: any) {
        setErrorMsg(e?.message || '注销失败');
      } finally {
        setBusy(false);
      }
    },
    [api, refresh],
  );

  const handleStatusChange = useCallback(
    async (agentId: string, status: AgentStatus) => {
      setBusy(true);
      setErrorMsg(null);
      try {
        await api.updateAgentStatus(agentId, status);
        await refresh();
      } catch (e: any) {
        setErrorMsg(e?.message || '更新状态失败');
      } finally {
        setBusy(false);
      }
    },
    [api, refresh],
  );

  const filtered = agents.filter(
    (a) => (!filterRole || a.role === filterRole) && (!filterStatus || a.status === filterStatus),
  );

  const toggleRisk = (r: RiskLevel) => {
    setFormRisks((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {errorMsg && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          ⚠️ {errorMsg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">Agent 注册表</h3>
        <button
          onClick={() => setShowRegister(!showRegister)}
          className="px-3 py-1.5 bg-violet-600 text-white text-sm rounded-md hover:bg-violet-700 transition-colors"
        >
          {showRegister ? '取消' : '+ 注册 Agent'}
        </button>
      </div>

      {showRegister && (
        <div className="rounded-md bg-violet-50 border border-violet-200 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Agent ID</label>
              <input
                type="text"
                value={formAgentId}
                onChange={(e) => setFormAgentId(e.target.value)}
                placeholder="agent_xxx"
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">名称</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="My Agent"
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">角色</label>
              <select
                value={formRole}
                onChange={(e) => setFormRole(e.target.value as AgentRole)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.icon} {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">最大负载</label>
              <input
                type="number"
                min={1}
                value={formMaxLoad}
                onChange={(e) => setFormMaxLoad(parseInt(e.target.value, 10) || 5)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-600">能力 (逗号分隔)</label>
              <input
                type="text"
                value={formCaps}
                onChange={(e) => setFormCaps(e.target.value)}
                placeholder="python, fastapi, typescript"
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-600">允许风险等级</label>
              <div className="flex gap-2 mt-1">
                {RISK_OPTIONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => toggleRisk(r.value)}
                    className={classNames(
                      'px-2.5 py-1 text-xs rounded-md border transition-colors',
                      formRisks.includes(r.value)
                        ? `${r.bgColor} ${r.color} border-current`
                        : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50',
                    )}
                  >
                    {r.icon} {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={handleRegister}
            disabled={busy}
            className="w-full py-2 bg-violet-600 text-white text-sm rounded-md hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {busy ? '注册中...' : '注册'}
          </button>
        </div>
      )}

      {/* 过滤 + 负载概览 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-600 mb-1">按角色过滤</div>
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as AgentRole | '')}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
          >
            <option value="">全部角色</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.icon} {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="rounded-md border border-gray-200 bg-white p-3">
          <div className="text-xs text-gray-600 mb-1">按状态过滤</div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as AgentStatus | '')}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
          >
            <option value="">全部状态</option>
            <option value="available">🟢 Available</option>
            <option value="busy">🟡 Busy</option>
            <option value="offline">⚫ Offline</option>
          </select>
        </div>
        <div className="rounded-md border border-gray-200 bg-gradient-to-br from-violet-50 to-purple-50 p-3">
          <div className="text-xs text-gray-600 mb-1">负载概览</div>
          {load ? (
            <div className="text-sm space-y-0.5">
              <div>总 Agent: <span className="font-semibold">{load.total_agents}</span></div>
              <div>平均负载: <span className="font-semibold">{load.avg_load}</span></div>
              <div className="text-xs text-gray-500">
                {Object.entries(load.by_role).map(([r, n]) => (
                  <span key={r} className="mr-2">{r}: {n}</span>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500">加载中...</div>
          )}
        </div>
      </div>

      {/* Agent 列表 */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
            暂无 Agent
          </div>
        ) : (
          filtered.map((a) => {
            const roleOpt = ROLE_OPTIONS.find((r) => r.value === a.role) || ROLE_OPTIONS[1];
            const statusColor =
              a.status === 'available' ? 'text-green-600 bg-green-50' :
              a.status === 'busy' ? 'text-yellow-600 bg-yellow-50' :
              'text-gray-500 bg-gray-100';
            return (
              <div key={a.agent_id} className="rounded-md border border-gray-200 bg-white p-3 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono text-gray-800">{a.agent_id}</span>
                      <span className={classNames('text-xs px-1.5 py-0.5 rounded', roleOpt.color, 'bg-gray-50')}>
                        {roleOpt.icon} {roleOpt.label}
                      </span>
                      <span className={classNames('text-xs px-1.5 py-0.5 rounded', statusColor)}>
                        {a.status}
                      </span>
                      <span className="text-xs text-gray-500">
                        负载 {a.current_load}/{a.max_load} · 成功率 {a.total_tasks > 0 ? Math.round((a.success_count / a.total_tasks) * 100) : 0}%
                      </span>
                    </div>
                    {a.capabilities.length > 0 && (
                      <div className="text-xs text-gray-500 mt-1">
                        能力: {a.capabilities.join(', ')}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-0.5">
                      风险等级: {a.risk_levels.join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {a.status !== 'available' && (
                      <button
                        onClick={() => handleStatusChange(a.agent_id, 'available')}
                        disabled={busy}
                        className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors disabled:opacity-50"
                      >
                        可用
                      </button>
                    )}
                    {a.status === 'available' && (
                      <button
                        onClick={() => handleStatusChange(a.agent_id, 'busy')}
                        disabled={busy}
                        className="px-2 py-1 text-xs bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition-colors disabled:opacity-50"
                      >
                        忙碌
                      </button>
                    )}
                    <button
                      onClick={() => handleStatusChange(a.agent_id, 'offline')}
                      disabled={busy}
                      className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors disabled:opacity-50"
                    >
                      离线
                    </button>
                    <button
                      onClick={() => handleUnregister(a.agent_id)}
                      disabled={busy}
                      className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors disabled:opacity-50"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ============================================================
// 子组件：Delegations Tab
// ============================================================

interface DelegationsTabProps {
  api: ReturnType<typeof useGoalAutomationApi>;
  refresh: () => Promise<void>;
}

const DelegationsTab: React.FC<DelegationsTabProps> = ({ api, refresh }) => {
  const [history, setHistory] = useState<DelegationResult[]>([]);
  const [filterGoal, setFilterGoal] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // 表单
  const [formGoalId, setFormGoalId] = useState('');
  const [formAcId, setFormAcId] = useState('');
  const [formAcTitle, setFormAcTitle] = useState('');
  const [formAcType, setFormAcType] = useState<ACType | ''>('');
  const [formRisk, setFormRisk] = useState<RiskLevel>('medium');
  const [formCaps, setFormCaps] = useState('');
  const [formPriority, setFormPriority] = useState(3);

  const loadHistory = useCallback(async () => {
    try {
      setErrorMsg(null);
      const r = await api.listDelegations(filterGoal || undefined, 50);
      setHistory(r.history);
    } catch (e: any) {
      setErrorMsg(e?.message || '加载失败');
    }
  }, [api, filterGoal]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleCreate = useCallback(async () => {
    if (!formGoalId.trim() || !formAcId.trim()) {
      setErrorMsg('Goal ID 和 AC ID 不能为空');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await api.createDelegation({
        goal_id: formGoalId.trim(),
        ac_id: formAcId.trim(),
        ac_title: formAcTitle.trim(),
        ac_type: formAcType || null,
        risk_level: formRisk,
        required_capabilities: formCaps.split(',').map((s) => s.trim()).filter(Boolean),
        priority: formPriority,
        context: {},
      });
      if (!r.success) {
        setErrorMsg(`委派失败: ${r.delegation.reason}`);
      } else {
        setShowCreate(false);
        setFormAcId('');
        setFormAcTitle('');
      }
      await loadHistory();
      await refresh();
    } catch (e: any) {
      setErrorMsg(e?.message || '创建失败');
    } finally {
      setBusy(false);
    }
  }, [api, formGoalId, formAcId, formAcTitle, formAcType, formRisk, formCaps, formPriority, loadHistory, refresh]);

  const handleComplete = useCallback(
    async (delegationId: string, success: boolean) => {
      setBusy(true);
      setErrorMsg(null);
      try {
        await api.completeDelegation(delegationId, success, { result: 'completed via UI' });
        await loadHistory();
        await refresh();
      } catch (e: any) {
        setErrorMsg(e?.message || '完成失败');
      } finally {
        setBusy(false);
      }
    },
    [api, loadHistory, refresh],
  );

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {errorMsg && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          ⚠️ {errorMsg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-800">委派历史</h3>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={filterGoal}
            onChange={(e) => setFilterGoal(e.target.value)}
            placeholder="按 Goal ID 过滤"
            className="px-2 py-1.5 text-sm border border-gray-300 rounded-md"
          />
          <button
            onClick={loadHistory}
            className="px-2 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
          >
            🔄
          </button>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-3 py-1.5 bg-pink-600 text-white text-sm rounded-md hover:bg-pink-700"
          >
            {showCreate ? '取消' : '+ 创建委派'}
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="rounded-md bg-pink-50 border border-pink-200 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-600">Goal ID</label>
              <input
                type="text"
                value={formGoalId}
                onChange={(e) => setFormGoalId(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                placeholder="goal_xxx"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">AC ID</label>
              <input
                type="text"
                value={formAcId}
                onChange={(e) => setFormAcId(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                placeholder="ac_1"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-600">AC 标题 (用于自动推断类型)</label>
              <input
                type="text"
                value={formAcTitle}
                onChange={(e) => setFormAcTitle(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                placeholder="Implement user login"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">AC 类型 (可选，自动推断)</label>
              <select
                value={formAcType}
                onChange={(e) => setFormAcType(e.target.value as ACType | '')}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
              >
                <option value="">自动推断</option>
                {AC_TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.icon} {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-600">风险等级</label>
              <select
                value={formRisk}
                onChange={(e) => setFormRisk(e.target.value as RiskLevel)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
              >
                {RISK_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.icon} {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs text-gray-600">能力要求 (逗号分隔)</label>
              <input
                type="text"
                value={formCaps}
                onChange={(e) => setFormCaps(e.target.value)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                placeholder="python, fastapi"
              />
            </div>
            <div>
              <label className="text-xs text-gray-600">优先级 (1-5)</label>
              <input
                type="number"
                min={1}
                max={5}
                value={formPriority}
                onChange={(e) => setFormPriority(parseInt(e.target.value, 10) || 1)}
                className="w-full mt-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
              />
            </div>
          </div>
          <button
            onClick={handleCreate}
            disabled={busy}
            className="w-full py-2 bg-pink-600 text-white text-sm rounded-md hover:bg-pink-700 transition-colors disabled:opacity-50"
          >
            {busy ? '创建中...' : '创建委派'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {history.length === 0 ? (
          <div className="rounded-md bg-gray-50 border border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
            暂无委派记录
          </div>
        ) : (
          history.map((d) => {
            const dec = DECISION_OPTIONS[d.decision] || DECISION_OPTIONS.failed;
            const acTypeOpt = AC_TYPE_OPTIONS.find((t) => t.value === d.ac_type) || AC_TYPE_OPTIONS[7];
            const riskOpt = RISK_OPTIONS.find((r) => r.value === d.risk_level) || RISK_OPTIONS[1];
            return (
              <div key={d.delegation_id} className="rounded-md border border-gray-200 bg-white p-3 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-mono text-gray-800">{d.delegation_id}</span>
                      <span className={classNames('text-xs px-1.5 py-0.5 rounded', dec.color, 'bg-gray-50')}>
                        {dec.icon} {dec.label}
                      </span>
                      <span className="text-xs text-gray-600">{acTypeOpt.icon} {acTypeOpt.label}</span>
                      <span className={classNames('text-xs px-1.5 py-0.5 rounded', riskOpt.color, riskOpt.bgColor)}>
                        {riskOpt.icon} {riskOpt.label}
                      </span>
                      {d.agent_id && (
                        <span className="text-xs text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded">
                          🤖 {d.agent_id}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      Goal: <span className="font-mono">{d.goal_id}</span> · AC: <span className="font-mono">{d.ac_id}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">{d.reason}</div>
                    {d.fallback_attempts.length > 0 && (
                      <div className="text-xs text-orange-600 mt-0.5">
                        回退: {d.fallback_attempts.join(' → ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    {d.decision === 'delegated' && !d.completed_at && (
                      <>
                        <button
                          onClick={() => handleComplete(d.delegation_id, true)}
                          disabled={busy}
                          className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
                          title="标记成功"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => handleComplete(d.delegation_id, false)}
                          disabled={busy}
                          className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
                          title="标记失败"
                        >
                          ✗
                        </button>
                      </>
                    )}
                    {d.completed_at && (
                      <span className="text-xs text-green-600">✅ 已完成</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

export const GoalAutomationPanel: React.FC<GoalAutomationPanelProps> = ({
  onClose,
  defaultUser = 'web_user',
  defaultProject = 'demo_project',
}) => {
  // defaultUser/defaultProject 保留供未来扩展
  void defaultUser;
  void defaultProject;

  const api = useGoalAutomationApi();
  const [tab, setTab] = useState<Tab>('auto-turn');
  const [stats, setStats] = useState<GoalAutomationStats | null>(null);
  const [goals, setGoals] = useState<ActiveGoal[]>([]);
  const [agents, setAgents] = useState<AgentSpec[]>([]);
  const [load, setLoad] = useState<LoadDistribution | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const [s, g, a, ld] = await Promise.all([
        api.getStats(),
        api.listActiveGoals(),
        api.listAgents(),
        api.getLoadDistribution(),
      ]);
      setStats(s);
      setGoals(g.goals);
      setAgents(a.agents);
      setLoad(ld.distribution);
    } catch (e: any) {
      setErrorMsg(e?.message || '刷新失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-blue-50 via-violet-50 to-pink-50 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎯</span>
          <h2 className="text-base font-semibold text-gray-800">Goal Automation</h2>
          <span className="text-xs text-gray-500">v6.32.0 · Cycle 14 P1-4</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={refreshAll}
            disabled={loading}
            className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
            title="刷新"
          >
            🔄
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="px-2 py-1 text-sm bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <StatsBar stats={stats} loading={loading && !stats} />

      {errorMsg && (
        <div className="rounded-md bg-red-50 border border-red-200 mx-4 mt-2 px-4 py-2 text-sm text-red-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* 标签栏 */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={classNames(
              'flex-1 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? `bg-white text-${t.color}-700 border-b-2 border-${t.color}-500`
                : 'text-gray-600 hover:bg-gray-100',
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {tab === 'auto-turn' && <AutoTurnTab api={api} goals={goals} refresh={refreshAll} />}
      {tab === 'agents' && <AgentsTab api={api} agents={agents} load={load} refresh={refreshAll} />}
      {tab === 'delegations' && <DelegationsTab api={api} refresh={refreshAll} />}
    </div>
  );
};

export default GoalAutomationPanel;
