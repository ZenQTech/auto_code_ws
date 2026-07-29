/**
 * # ============================================================
 * # ProactiveSuggestionPanel - AI 主动建议 UI (v1.0.0 Cycle 23 G23-04)
 * # ============================================================
 * # 核心作用：AI 主动建议引擎的可视化控制面板
 * # 主要功能：
 * #   1. 活跃建议列表（卡片式）
 * #   2. 建议历史（接受/拒绝记录）
 * #   3. 配置（启用类型/阈值/频率）
 * #   4. 类型权重 Dashboard
 * #   5. 模拟建议生成
 * #   6. 浮动气泡（FloatingBubble）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 23 G23-04 初次创建
 * #   - 2026-07-29 | v1.0.1 | UI/UX 优化：渐变背景 + 渐入动画 + Esc 关闭
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getProactiveSuggestionEngine,
  type Suggestion,
  type SuggestionType,
  type SuggestionConfig,
  type SuggestionStats,
  type SuggestionFeedbackRecord,
  type SessionContext,
  type ConversationState,
  type TaskType,
} from '../utils/proactiveSuggestion';
import { EmptyState } from './EmptyState';

interface ProactiveSuggestionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<SuggestionType, string> = {
  'next-action': '下一步操作',
  'related-feature': '相关功能',
  faq: '常见问题',
  optimization: '优化提示',
};

const TYPE_ICONS: Record<SuggestionType, string> = {
  'next-action': '👉',
  'related-feature': '🧩',
  faq: '❓',
  optimization: '⚡',
};

const TYPE_COLORS: Record<SuggestionType, string> = {
  'next-action': 'border-blue-500/40 bg-blue-500/10',
  'related-feature': 'border-violet-500/40 bg-violet-500/10',
  faq: 'border-amber-500/40 bg-amber-500/10',
  optimization: 'border-emerald-500/40 bg-emerald-500/10',
};

const STATE_LABELS: Record<ConversationState, string> = {
  idle: '空闲',
  active: '对话中',
  workflow: '工作流中',
  error: '错误',
};

const TASK_LABELS: Record<TaskType, string> = {
  coding: '编码',
  writing: '写作',
  analysis: '分析',
  learning: '学习',
  general: '通用',
};

const FEEDBACK_COLORS = {
  accepted: 'bg-emerald-500/20 text-emerald-300',
  dismissed: 'bg-rose-500/20 text-rose-300',
  ignored: 'bg-slate-500/20 text-slate-300',
};

const FEEDBACK_LABELS = {
  accepted: '✓ 已接受',
  dismissed: '✕ 已拒绝',
  ignored: '⏸ 已忽略',
};

export function ProactiveSuggestionPanel({ isOpen, onClose }: ProactiveSuggestionPanelProps) {
  const engine = useMemo(() => getProactiveSuggestionEngine(), []);
  const [stats, setStats] = useState<SuggestionStats>(engine.getStats());
  const [config, setConfig] = useState<SuggestionConfig>(engine.getConfig());
  const [active, setActive] = useState<Suggestion[]>(engine.getActiveSuggestions());
  const [history, setHistory] = useState<SuggestionFeedbackRecord[]>(engine.getHistory(50));
  const [weights, setWeights] = useState<Record<SuggestionType, number>>(engine.getTypeWeights());
  const [activeTab, setActiveTab] = useState<'active' | 'history' | 'config' | 'simulate'>('active');
  const [error, setError] = useState<string | null>(null);

  // 模拟上下文
  const [simContext, setSimContext] = useState<SessionContext>({
    conversationState: 'active',
    taskType: 'coding',
    messageCount: 12,
    hasError: false,
    hasPendingTasks: true,
    costSoFar: 45,
    budgetLimit: 60,
  });

  const refresh = useCallback(() => {
    setStats(engine.getStats());
    setConfig(engine.getConfig());
    setActive(engine.getActiveSuggestions());
    setHistory(engine.getHistory(50));
    setWeights(engine.getTypeWeights());
  }, [engine]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const off1 = engine.on('suggestion-generated', refresh);
    const off2 = engine.on('suggestion-accepted', refresh);
    const off3 = engine.on('suggestion-dismissed', refresh);
    const off4 = engine.on('suggestion-expired', refresh);
    const off5 = engine.on('config-updated', refresh);
    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
    };
  }, [isOpen, engine, refresh]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 接受建议
  const handleAccept = useCallback(
    (suggestionId: string) => {
      setError(null);
      try {
        engine.acceptSuggestion(suggestionId);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : '操作失败');
      }
    },
    [engine, refresh]
  );

  // 拒绝建议
  const handleDismiss = useCallback(
    (suggestionId: string) => {
      try {
        engine.dismissSuggestion(suggestionId);
        refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : '操作失败');
      }
    },
    [engine, refresh]
  );

  // 模拟生成
  const handleSimulate = useCallback(() => {
    setError(null);
    try {
      engine.generateSuggestions(simContext);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    }
  }, [engine, simContext, refresh]);

  // 更新配置
  const handleUpdateConfig = useCallback(
    (patch: Partial<SuggestionConfig>) => {
      engine.updateConfig(patch);
      refresh();
    },
    [engine, refresh]
  );

  // 清空所有
  const handleClearAll = useCallback(() => {
    if (confirm('确认清空所有建议？')) {
      engine.clearAll();
      refresh();
    }
  }, [engine, refresh]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="proactive-suggestion-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[90vw] max-w-6xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center">
              <span className="text-white text-sm">💡</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">AI 主动建议</h2>
              <p className="text-xs text-slate-400">基于上下文主动提示用户下一步操作</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleClearAll}
              data-testid="suggestion-clear"
              className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs rounded transition"
            >
              清空
            </button>
            <button
              onClick={onClose}
              data-testid="suggestion-close"
              className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700 bg-surface-800/50">
          {(
            [
              { key: 'active', label: `活跃建议 (${active.length})` },
              { key: 'history', label: '历史' },
              { key: 'config', label: '配置' },
              { key: 'simulate', label: '模拟' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              data-testid={`suggestion-tab-${t.key}`}
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
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-sm">
              {error}
            </div>
          )}

          {activeTab === 'active' && (
            <ActiveTab
              suggestions={active}
              stats={stats}
              weights={weights}
              onAccept={handleAccept}
              onDismiss={handleDismiss}
            />
          )}
          {activeTab === 'history' && <HistoryTab history={history} />}
          {activeTab === 'config' && <ConfigTab config={config} weights={weights} onUpdate={handleUpdateConfig} />}
          {activeTab === 'simulate' && (
            <SimulateTab context={simContext} setContext={setSimContext} onSimulate={handleSimulate} />
          )}
        </div>
      </div>
    </div>
  );
}

// ====== Tab 子组件 ======

function ActiveTab({
  suggestions,
  stats,
  weights,
  onAccept,
  onDismiss,
}: {
  suggestions: Suggestion[];
  stats: SuggestionStats;
  weights: Record<SuggestionType, number>;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="space-y-4" data-testid="suggestion-active">
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="总生成" value={stats.totalGenerated.toString()} />
        <MetricCard label="已接受" value={stats.totalAccepted.toString()} color="text-emerald-400" />
        <MetricCard label="已拒绝" value={stats.totalDismissed.toString()} color="text-rose-400" />
        <MetricCard
          label="接受率"
          value={`${(stats.acceptanceRate * 100).toFixed(1)}%`}
          color={stats.acceptanceRate > 0.6 ? 'text-emerald-400' : 'text-white'}
        />
      </div>

      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">类型权重（反馈学习）</h3>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(TYPE_LABELS) as SuggestionType[]).map((t) => (
            <div key={t} className="bg-surface-900 border border-surface-700 rounded p-2">
              <div className="text-xs text-slate-400 mb-1">{TYPE_ICONS[t]} {TYPE_LABELS[t]}</div>
              <div className="flex items-center gap-1">
                <div className="flex-1 h-1.5 bg-surface-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-rose-500 to-orange-500"
                    style={{ width: `${Math.min(100, (weights[t] || 1) * 50)}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 w-10 text-right">{(weights[t] || 1).toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {suggestions.length === 0 ? (
        <EmptyState
          icon="💡"
          title="暂无活跃建议"
          description="切换到「模拟」页可以基于不同上下文生成测试建议，或在真实对话中由 AI 主动推送。"
          tone="info"
          testId="suggestion-empty"
          compact
        />
      ) : (
        <div className="space-y-2" data-testid="suggestion-list">
          {suggestions.map((s) => (
            <div
              key={s.suggestionId}
              data-testid={`suggestion-${s.suggestionId}`}
              className={`rounded-lg border p-4 ${TYPE_COLORS[s.type]}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-base">{TYPE_ICONS[s.type]}</span>
                    <h4 className="text-white font-medium">{s.title}</h4>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-slate-300">
                      {TYPE_LABELS[s.type]}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      置信度 {(s.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 mb-2">{s.description}</p>
                  <div className="text-xs text-slate-500">📌 {s.reason}</div>
                </div>
                <div className="flex flex-col gap-1">
                  {s.action && (
                    <button
                      onClick={() => onAccept(s.suggestionId)}
                      data-testid={`suggestion-accept-${s.suggestionId}`}
                      className="px-3 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs rounded transition"
                    >
                      {s.action.label}
                    </button>
                  )}
                  <button
                    onClick={() => onDismiss(s.suggestionId)}
                    data-testid={`suggestion-dismiss-${s.suggestionId}`}
                    className="px-3 py-1 bg-surface-700 hover:bg-surface-600 text-slate-300 text-xs rounded transition"
                  >
                    忽略
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryTab({ history }: { history: SuggestionFeedbackRecord[] }) {
  if (history.length === 0) {
    return (
      <EmptyState
        icon="📋"
        title="暂无历史记录"
        description="用户接受/拒绝/忽略建议后，会在此留下反馈轨迹用于权重学习。"
        tone="neutral"
        testId="suggestion-history-empty"
        compact
      />
    );
  }
  return (
    <div className="space-y-2" data-testid="suggestion-history">
      {history.map((r) => (
        <div key={`${r.suggestionId}-${r.timestamp}`} className="bg-surface-800 border border-surface-700 rounded-lg p-3 flex items-center gap-3">
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${FEEDBACK_COLORS[r.feedback]}`}>
            {FEEDBACK_LABELS[r.feedback]}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-slate-300">
            {TYPE_LABELS[r.type]}
          </span>
          <span className="text-sm text-white flex-1 truncate">{r.title}</span>
          <span className="text-xs text-slate-500">{(r.durationMs / 1000).toFixed(1)}s</span>
          <span className="text-xs text-slate-500">{new Date(r.timestamp).toLocaleTimeString()}</span>
        </div>
      ))}
    </div>
  );
}

function ConfigTab({
  config,
  weights,
  onUpdate,
}: {
  config: SuggestionConfig;
  weights: Record<SuggestionType, number>;
  onUpdate: (patch: Partial<SuggestionConfig>) => void;
}) {
  void weights;
  return (
    <div className="space-y-4 max-w-2xl" data-testid="suggestion-config">
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white mb-2">基础配置</h3>
        <ConfigRow label="最大活跃数">
          <input
            type="number"
            min={1}
            max={20}
            value={config.maxActiveSuggestions}
            onChange={(e) => onUpdate({ maxActiveSuggestions: Number(e.target.value) })}
            data-testid="config-max-active"
            className="w-24 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          />
        </ConfigRow>
        <ConfigRow label="去重窗口 (ms)">
          <input
            type="number"
            min={10000}
            max={3600000}
            step={10000}
            value={config.dedupWindowMs}
            onChange={(e) => onUpdate({ dedupWindowMs: Number(e.target.value) })}
            data-testid="config-dedup-window"
            className="w-32 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          />
        </ConfigRow>
        <ConfigRow label="默认 TTL (ms)">
          <input
            type="number"
            min={60000}
            max={3600000}
            step={60000}
            value={config.defaultTtlMs}
            onChange={(e) => onUpdate({ defaultTtlMs: Number(e.target.value) })}
            data-testid="config-ttl"
            className="w-32 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          />
        </ConfigRow>
        <ConfigRow label="空闲阈值 (ms)">
          <input
            type="number"
            min={5000}
            max={600000}
            step={5000}
            value={config.idleThresholdMs}
            onChange={(e) => onUpdate({ idleThresholdMs: Number(e.target.value) })}
            data-testid="config-idle"
            className="w-32 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          />
        </ConfigRow>
        <ConfigRow label="空闲时显示">
          <input
            type="checkbox"
            checked={config.showOnIdle}
            onChange={(e) => onUpdate({ showOnIdle: e.target.checked })}
            data-testid="config-show-on-idle"
            className="w-4 h-4 accent-primary-500"
          />
        </ConfigRow>
        <ConfigRow label="启用 LLM 生成">
          <input
            type="checkbox"
            checked={config.enableLLMGeneration}
            onChange={(e) => onUpdate({ enableLLMGeneration: e.target.checked })}
            data-testid="config-llm"
            className="w-4 h-4 accent-primary-500"
          />
        </ConfigRow>
      </div>
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-2">启用的建议类型</h3>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(TYPE_LABELS) as SuggestionType[]).map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={config.enabledTypes.includes(t)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...config.enabledTypes, t]
                    : config.enabledTypes.filter((x) => x !== t);
                  onUpdate({ enabledTypes: next });
                }}
                data-testid={`config-type-${t}`}
                className="w-4 h-4 accent-primary-500"
              />
              {TYPE_ICONS[t]} {TYPE_LABELS[t]}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function SimulateTab({
  context,
  setContext,
  onSimulate,
}: {
  context: SessionContext;
  setContext: (c: SessionContext) => void;
  onSimulate: () => void;
}) {
  return (
    <div className="space-y-4 max-w-2xl" data-testid="suggestion-simulate">
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4 space-y-3">
        <h3 className="text-sm font-semibold text-white mb-2">构造上下文</h3>
        <ConfigRow label="对话状态">
          <select
            value={context.conversationState}
            onChange={(e) => setContext({ ...context, conversationState: e.target.value as ConversationState })}
            data-testid="sim-state"
            className="px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          >
            {(Object.keys(STATE_LABELS) as ConversationState[]).map((s) => (
              <option key={s} value={s}>
                {STATE_LABELS[s]}
              </option>
            ))}
          </select>
        </ConfigRow>
        <ConfigRow label="任务类型">
          <select
            value={context.taskType}
            onChange={(e) => setContext({ ...context, taskType: e.target.value as TaskType })}
            data-testid="sim-task"
            className="px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          >
            {(Object.keys(TASK_LABELS) as TaskType[]).map((t) => (
              <option key={t} value={t}>
                {TASK_LABELS[t]}
              </option>
            ))}
          </select>
        </ConfigRow>
        <ConfigRow label="消息数">
          <input
            type="number"
            min={0}
            max={1000}
            value={context.messageCount || 0}
            onChange={(e) => setContext({ ...context, messageCount: Number(e.target.value) })}
            data-testid="sim-msg-count"
            className="w-24 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          />
        </ConfigRow>
        <ConfigRow label="存在错误">
          <input
            type="checkbox"
            checked={context.hasError || false}
            onChange={(e) => setContext({ ...context, hasError: e.target.checked })}
            data-testid="sim-has-error"
            className="w-4 h-4 accent-primary-500"
          />
        </ConfigRow>
        <ConfigRow label="有待办任务">
          <input
            type="checkbox"
            checked={context.hasPendingTasks || false}
            onChange={(e) => setContext({ ...context, hasPendingTasks: e.target.checked })}
            data-testid="sim-has-pending"
            className="w-4 h-4 accent-primary-500"
          />
        </ConfigRow>
        <ConfigRow label="已消耗成本">
          <input
            type="number"
            min={0}
            value={context.costSoFar || 0}
            onChange={(e) => setContext({ ...context, costSoFar: Number(e.target.value) })}
            data-testid="sim-cost"
            className="w-24 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          />
        </ConfigRow>
        <ConfigRow label="预算上限">
          <input
            type="number"
            min={0}
            value={context.budgetLimit || 0}
            onChange={(e) => setContext({ ...context, budgetLimit: Number(e.target.value) })}
            data-testid="sim-budget"
            className="w-24 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
          />
        </ConfigRow>
        <button
          onClick={onSimulate}
          data-testid="sim-generate"
          className="mt-3 px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded transition"
        >
          生成建议
        </button>
      </div>
    </div>
  );
}

function ConfigRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-slate-300 w-32">{label}</label>
      {children}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-surface-800 border border-surface-700 rounded-lg p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-lg font-bold mt-1 ${color || 'text-white'}`}>{value}</div>
    </div>
  );
}

// ====== 浮动气泡组件 ======

interface FloatingSuggestionBubbleProps {
  onOpenPanel: () => void;
}

export function FloatingSuggestionBubble({ onOpenPanel }: FloatingSuggestionBubbleProps) {
  const engine = useMemo(() => getProactiveSuggestionEngine(), []);
  const [topSuggestion, setTopSuggestion] = useState<Suggestion | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissedId, setDismissedId] = useState<string | null>(null);

  useEffect(() => {
    const check = () => {
      const active = engine.getActiveSuggestions();
      // 过滤已被本地 dismiss 的建议
      const filtered = active.filter((s) => s.suggestionId !== dismissedId);
      if (filtered.length > 0) {
        setTopSuggestion(filtered[0]);
        setVisible(true);
      } else {
        setVisible(false);
      }
    };
    check();
    const interval = setInterval(check, 5000);
    const off1 = engine.on('suggestion-generated', check);
    const off2 = engine.on('suggestion-accepted', check);
    const off3 = engine.on('suggestion-dismissed', check);
    const off4 = engine.on('suggestion-expired', check);
    return () => {
      clearInterval(interval);
      off1();
      off2();
      off3();
      off4();
    };
  }, [engine, dismissedId]);

  // 当建议变化时重置 dismissedId
  useEffect(() => {
    if (topSuggestion && topSuggestion.suggestionId !== dismissedId) {
      setDismissedId(null);
    }
  }, [topSuggestion, dismissedId]);

  const handleDismiss = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (topSuggestion) {
        engine.dismissSuggestion(topSuggestion.suggestionId);
        setDismissedId(topSuggestion.suggestionId);
      }
    },
    [engine, topSuggestion]
  );

  if (!visible || !topSuggestion) return null;

  return (
    <div
      data-testid="floating-suggestion-bubble"
      className="fixed bottom-4 right-4 z-40 max-w-xs animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <div className="bg-gradient-to-br from-rose-500/95 to-orange-500/95 text-white rounded-2xl shadow-2xl ring-1 ring-white/20 overflow-hidden">
        <button
          onClick={onOpenPanel}
          title={topSuggestion.description}
          className="w-full text-left px-4 py-3 flex items-center gap-3 hover:from-rose-500 hover:to-orange-500 transition"
        >
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-lg shrink-0">
            {TYPE_ICONS[topSuggestion.type]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-wider opacity-80">
              {TYPE_LABELS[topSuggestion.type]} · 置信度 {(topSuggestion.confidence * 100).toFixed(0)}%
            </div>
            <div className="text-sm font-medium truncate">{topSuggestion.title}</div>
          </div>
          <span className="opacity-80 text-lg shrink-0">→</span>
        </button>
        <div className="px-3 pb-2 flex items-center justify-between border-t border-white/15">
          <span className="text-[10px] opacity-70 truncate">{topSuggestion.reason}</span>
          <button
            onClick={handleDismiss}
            data-testid="floating-suggestion-bubble-dismiss"
            className="ml-2 px-2 py-0.5 text-[10px] rounded bg-white/15 hover:bg-white/25 transition shrink-0"
            aria-label="关闭建议气泡"
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
