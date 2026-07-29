/**
 * # ============================================================
 * # BestOfNCoordinatorPanel - Best-of-N 协同 UI (v1.0.0 Cycle 21 G21-01)
 * # ============================================================
 * # 核心作用：Best-of-N × Worktree 协同的可视化界面
 * # 主要功能：
 * #   1. 输入 prompt + 候选模型，启动协同会话
 * #   2. 实时展示所有候选 worktree 状态
 * #   3. 显示对比分析（评分、优势、劣势）
 * #   4. 支持应用/丢弃候选
 * #   5. 支持选择策略
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-01 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getBestOfNCoordinator,
  type CoordinatorSession,
  type CandidateState,
  type ComparisonResult,
  type SelectionStrategy,
  type CoordinatorEvent,
} from '../utils/bestOfNCoordinator';

interface BestOfNCoordinatorPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const MODEL_OPTIONS = [
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', tier: 'high' },
  { id: 'gpt-5', name: 'GPT-5', tier: 'high' },
  { id: 'gpt-4o', name: 'GPT-4o', tier: 'mid' },
  { id: 'deepseek-v3.2', name: 'DeepSeek V3.2', tier: 'low' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', tier: 'low' },
];

const STRATEGY_LABELS: Record<SelectionStrategy, string> = {
  manual: '手动选择',
  fastest: '最快',
  cheapest: '最低成本',
  'highest-rated': '综合最优',
  'lowest-cost': '最低成本',
};

const STATUS_LABELS: Record<CandidateState['status'], string> = {
  pending: '等待',
  'creating-worktree': '创建 Worktree',
  executing: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  discarded: '已丢弃',
  merged: '已合并',
};

const STATUS_COLORS: Record<CandidateState['status'], string> = {
  pending: 'bg-slate-500/20 text-slate-300',
  'creating-worktree': 'bg-blue-500/20 text-blue-300',
  executing: 'bg-yellow-500/20 text-yellow-300 animate-pulse',
  completed: 'bg-green-500/20 text-green-300',
  failed: 'bg-red-500/20 text-red-300',
  cancelled: 'bg-slate-500/20 text-slate-400',
  discarded: 'bg-slate-500/20 text-slate-400',
  merged: 'bg-purple-500/20 text-purple-300',
};

export function BestOfNCoordinatorPanel({ isOpen, onClose }: BestOfNCoordinatorPanelProps) {
  const coordinator = useMemo(() => getBestOfNCoordinator(), []);
  const [sessions, setSessions] = useState<CoordinatorSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);

  // 表单状态
  const [prompt, setPrompt] = useState('');
  const [selectedModels, setSelectedModels] = useState<string[]>(['claude-sonnet-4.5', 'gpt-5']);
  const [strategy, setStrategy] = useState<SelectionStrategy>('manual');
  const [autoApply, setAutoApply] = useState(false);
  const [launching, setLaunching] = useState(false);

  // 刷新会话列表
  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => {
      setSessions(coordinator.listSessions({ sortBy: 'startedAt', sortOrder: 'desc', limit: 20 }));
    };
    refresh();
    const unsub = (_event: CoordinatorEvent) => {
      refresh();
      // 同步当前活跃会话
      if (activeSessionId) {
        const updated = coordinator.getSession(activeSessionId);
        if (updated) {
          setSessions((prev) => prev.map((s) => (s.sessionId === updated.sessionId ? updated : s)));
        }
      }
    };
    const off = coordinator.on('session-created', unsub);
    const off2 = coordinator.on('session-completed', unsub);
    const off3 = coordinator.on('candidate-completed', unsub);
    const off4 = coordinator.on('candidate-merged', unsub);
    return () => {
      off();
      off2();
      off3();
      off4();
    };
  }, [coordinator, isOpen, activeSessionId]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !launching) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, launching]);

  // 启动会话
  const handleLaunch = useCallback(async () => {
    if (!prompt.trim() || selectedModels.length === 0) return;
    setLaunching(true);
    try {
      const session = await coordinator.launch(prompt, selectedModels, {
        selectionStrategy: strategy,
        autoApplyBest: autoApply,
      });
      setActiveSessionId(session.sessionId);
      setComparison(null);
    } catch (err) {
      console.error('Launch failed:', err);
    } finally {
      setLaunching(false);
    }
  }, [coordinator, prompt, selectedModels, strategy, autoApply]);

  // 对比候选
  const handleCompare = useCallback(async () => {
    if (!activeSessionId) return;
    try {
      const result = await coordinator.compareCandidates(activeSessionId, { strategy });
      setComparison(result);
    } catch (err) {
      console.error('Compare failed:', err);
    }
  }, [coordinator, activeSessionId, strategy]);

  // 应用候选
  const handleApply = useCallback(async (candidateId: string) => {
    if (!activeSessionId) return;
    try {
      await coordinator.applyCandidate(activeSessionId, candidateId);
      const result = await coordinator.compareCandidates(activeSessionId, { strategy });
      setComparison(result);
    } catch (err) {
      console.error('Apply failed:', err);
    }
  }, [coordinator, activeSessionId, strategy]);

  // 丢弃候选
  const handleDiscard = useCallback(async (candidateId: string) => {
    if (!activeSessionId) return;
    try {
      await coordinator.discardCandidate(activeSessionId, candidateId);
    } catch (err) {
      console.error('Discard failed:', err);
    }
  }, [coordinator, activeSessionId]);

  // 切换模型选择
  const toggleModel = (modelId: string) => {
    setSelectedModels((prev) =>
      prev.includes(modelId) ? prev.filter((m) => m !== modelId) : [...prev, modelId]
    );
  };

  if (!isOpen) return null;

  const activeSession = activeSessionId ? coordinator.getSession(activeSessionId) : null;

  return (
    <div
      data-testid="best-of-n-coordinator-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !launching) onClose();
      }}
    >
      <div className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl w-[1000px] max-w-[95vw] max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-700">
          <div>
            <h2 className="text-xl font-semibold text-white">Best-of-N × Worktree 协同</h2>
            <p className="text-sm text-slate-400 mt-1">为每个模型候选创建独立 Worktree，安全对比</p>
          </div>
          <button
            onClick={onClose}
            disabled={launching}
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {!activeSession ? (
            <div className="space-y-5">
              {/* Prompt 输入 */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">任务 Prompt</label>
                <textarea
                  data-testid="coordinator-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  placeholder="输入要协同执行的任务，例如：实现一个 React 组件..."
                  className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
                />
              </div>

              {/* 模型选择 */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  候选模型 <span className="text-slate-500">({selectedModels.length} 已选)</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {MODEL_OPTIONS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => toggleModel(m.id)}
                      data-testid={`model-option-${m.id}`}
                      className={`px-3 py-2 rounded-lg text-sm border transition ${
                        selectedModels.includes(m.id)
                          ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                          : 'bg-surface-800 border-surface-600 text-slate-400 hover:border-surface-500'
                      }`}
                    >
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs opacity-70">tier: {m.tier}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* 策略选择 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">选择策略</label>
                  <select
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value as SelectionStrategy)}
                    data-testid="coordinator-strategy"
                    className="w-full px-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-white"
                  >
                    {(Object.keys(STRATEGY_LABELS) as SelectionStrategy[]).map((s) => (
                      <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoApply}
                      onChange={(e) => setAutoApply(e.target.checked)}
                      data-testid="coordinator-auto-apply"
                      className="w-4 h-4 rounded border-surface-600 bg-surface-800 text-primary-500 focus:ring-primary-500"
                    />
                    <span className="text-sm text-slate-300">自动应用最佳候选</span>
                  </label>
                </div>
              </div>

              {/* 启动按钮 */}
              <button
                onClick={handleLaunch}
                disabled={!prompt.trim() || selectedModels.length === 0 || launching}
                data-testid="coordinator-launch"
                className="w-full px-4 py-3 bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:text-slate-500 text-white font-medium rounded-lg transition"
              >
                {launching ? '启动中...' : `启动协同 (${selectedModels.length} 个候选)`}
              </button>

              {/* 历史会话 */}
              {sessions.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-slate-300 mb-2">历史会话</h3>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {sessions.map((s) => (
                      <button
                        key={s.sessionId}
                        onClick={() => {
                          setActiveSessionId(s.sessionId);
                          setComparison(null);
                        }}
                        data-testid={`session-${s.sessionId}`}
                        className="w-full text-left px-3 py-2 bg-surface-800 hover:bg-surface-700 rounded-lg border border-surface-700"
                      >
                        <div className="text-sm text-white truncate">{s.prompt}</div>
                        <div className="text-xs text-slate-500 mt-1">
                          {s.models.length} 模型 · {s.status} · {new Date(s.startedAt).toLocaleString()}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* 会话信息 */}
              <div className="bg-surface-800/50 rounded-lg p-4 border border-surface-700">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-lg font-semibold text-white">协同会话</h3>
                  <button
                    onClick={() => {
                      setActiveSessionId(null);
                      setComparison(null);
                    }}
                    className="text-sm text-slate-400 hover:text-white"
                  >
                    ← 返回
                  </button>
                </div>
                <p className="text-sm text-slate-300 mb-2">{activeSession.prompt}</p>
                <div className="text-xs text-slate-500">
                  状态: {activeSession.status} · 候选: {activeSession.candidates.length} · 策略: {STRATEGY_LABELS[activeSession.options.selectionStrategy ?? 'manual']}
                </div>
              </div>

              {/* 候选列表 */}
              <div>
                <h3 className="text-sm font-medium text-slate-300 mb-2">候选 Worktree</h3>
                <div className="space-y-2" data-testid="candidate-list">
                  {activeSession.candidates.map((c) => (
                    <div
                      key={c.candidateId}
                      data-testid={`candidate-${c.candidateId}`}
                      className="bg-surface-800/50 rounded-lg p-3 border border-surface-700"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className="font-medium text-white">{c.model}</span>
                          <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[c.status]}`}>
                            {STATUS_LABELS[c.status]}
                          </span>
                          {c.cached && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300">
                              缓存
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {c.status === 'completed' && (
                            <>
                              <button
                                onClick={() => handleApply(c.candidateId)}
                                data-testid={`apply-${c.candidateId}`}
                                className="text-xs px-2 py-1 bg-green-500/20 text-green-300 rounded hover:bg-green-500/30"
                              >
                                应用
                              </button>
                              <button
                                onClick={() => handleDiscard(c.candidateId)}
                                data-testid={`discard-${c.candidateId}`}
                                className="text-xs px-2 py-1 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
                              >
                                丢弃
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      {(c.tokens || c.cost !== undefined) && (
                        <div className="text-xs text-slate-500 mt-2 flex gap-3">
                          {c.tokens && (
                            <span>tokens: {c.tokens.input}/{c.tokens.output}</span>
                          )}
                          {c.cost !== undefined && <span>cost: ${c.cost.toFixed(4)}</span>}
                          {c.duration !== undefined && <span>duration: {c.duration}ms</span>}
                          {c.worktreePath && <span className="font-mono">{c.worktreePath}</span>}
                        </div>
                      )}
                      {c.error && (
                        <div className="text-xs text-red-400 mt-2">错误: {c.error}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 对比按钮 */}
              {activeSession.candidates.some((c) => c.status === 'completed' || c.status === 'merged') && (
                <button
                  onClick={handleCompare}
                  data-testid="coordinator-compare"
                  className="w-full px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition"
                >
                  生成对比分析
                </button>
              )}

              {/* 对比结果 */}
              {comparison && (
                <div data-testid="comparison-result" className="space-y-3">
                  {comparison.recommendation && (
                    <div className="bg-primary-500/10 border border-primary-500/30 rounded-lg p-3">
                      <div className="text-sm font-medium text-primary-300">推荐</div>
                      <div className="text-white mt-1">
                        {comparison.candidates.find((c) => c.candidateId === comparison.recommendation?.candidateId)?.model}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">{comparison.recommendation.reason}</div>
                    </div>
                  )}

                  <h3 className="text-sm font-medium text-slate-300">对比分析</h3>
                  <div className="space-y-2">
                    {comparison.candidates.map((c) => (
                      <div key={c.candidateId} className="bg-surface-800/50 rounded-lg p-3 border border-surface-700">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-white">{c.model}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-400">评分: {c.score.toFixed(1)}</span>
                            <span className="text-yellow-400">{'★'.repeat(c.rating)}</span>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-xs text-slate-400 mb-2">
                          <span>耗时: {c.metrics.duration}ms</span>
                          <span>成本: ${c.metrics.cost.toFixed(4)}</span>
                          <span>tokens: {c.metrics.tokens.input}/{c.metrics.tokens.output}</span>
                          <span>变更: {c.metrics.filesChanged} 文件</span>
                          <span>新增: {c.metrics.additions}</span>
                          <span>删除: {c.metrics.deletions}</span>
                        </div>
                        {c.strengths.length > 0 && (
                          <div className="text-xs text-green-300 mb-1">
                            ✓ {c.strengths.join(', ')}
                          </div>
                        )}
                        {c.weaknesses.length > 0 && (
                          <div className="text-xs text-red-300">
                            ✗ {c.weaknesses.join(', ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BestOfNCoordinatorPanel;
