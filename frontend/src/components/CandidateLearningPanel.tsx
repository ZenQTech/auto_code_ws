/**
 * # ============================================================
 * # CandidateLearningPanel - 候选学习 UI (v1.0.0 Cycle 23 G23-01)
 * # ============================================================
 * # 核心作用：候选学习引擎的可视化控制面板
 * # 主要功能：
 * #   1. 学习记录查看
 * #   2. 用户偏好画像展示
 * #   3. 模型偏好权重调整
 * #   4. 推荐解释（模拟）
 * #   5. 学习算法切换
 * #   6. 统计 Dashboard
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 23 G23-01 初次创建
 * #   - 2026-07-29 | v1.0.1 | UI/UX 优化：渐变背景 + 渐入动画 + Esc 关闭
 * #   - 2026-07-29 | v1.0.2 | 修复 engine API 对齐（applyPreferences/事件名）
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getCandidateLearningEngine,
  type LearningAlgorithm,
  type LearningConfig,
  type LearningStats,
  type UserPreferenceVector,
  type CandidateLearningRecord,
  type CandidateScore,
  type TaskType,
  type AdjustedScore,
} from '../utils/candidateLearning';
import { EmptyState } from './EmptyState';

interface CandidateLearningPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const ALGO_LABELS: Record<LearningAlgorithm, string> = {
  weighted: '加权平均',
  bayesian: '贝叶斯',
  collaborative: '协同过滤',
  reinforcement: '强化学习',
};

const TASK_LABELS: Record<TaskType, string> = {
  coding: '编码',
  writing: '写作',
  analysis: '分析',
  learning: '学习',
  general: '通用',
};

const FEEDBACK_COLORS = {
  positive: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  negative: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  neutral: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
};

const FEEDBACK_LABELS = {
  positive: '👍 好评',
  negative: '👎 差评',
  neutral: '➖ 中立',
};

export function CandidateLearningPanel({ isOpen, onClose }: CandidateLearningPanelProps) {
  const engine = useMemo(() => getCandidateLearningEngine(), []);
  const [stats, setStats] = useState<LearningStats>(engine.getStats());
  const [config, setConfig] = useState<LearningConfig>(engine.getConfig());
  const [preferences, setPreferences] = useState<UserPreferenceVector>(engine.getPreferences());
  const [records, setRecords] = useState<CandidateLearningRecord[]>([]);
  const [algorithm, setAlgorithm] = useState<LearningAlgorithm>(engine.getConfig().algorithm);
  const [activeTab, setActiveTab] = useState<'overview' | 'preferences' | 'records' | 'simulate'>(
    'overview'
  );
  const [simResult, setSimResult] = useState<AdjustedScore[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 模拟候选
  const [simTask] = useState<TaskType>('coding');
  const [simPrompt, setSimPrompt] = useState('实现一个 TypeScript 函数');
  const [simCandidates, setSimCandidates] = useState([
    { modelId: 'claude-sonnet-4.5', score: 85 },
    { modelId: 'gpt-5', score: 82 },
    { modelId: 'deepseek-v3.2', score: 78 },
    { modelId: 'gemini-2.0-pro', score: 80 },
  ]);

  const refresh = useCallback(() => {
    setStats(engine.getStats());
    setPreferences(engine.getPreferences());
    setRecords(engine.getRecords().slice(-50).reverse());
  }, [engine]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const off1 = engine.on('decision-recorded', refresh);
    const off2 = engine.on('preference-updated', refresh);
    const off3 = engine.on('feedback-submitted', refresh);
    const off4 = engine.on('config-updated', () => {
      setConfig(engine.getConfig());
      refresh();
    });
    return () => {
      off1();
      off2();
      off3();
      off4();
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

  // 模拟推荐
  const handleSimulate = useCallback(() => {
    setError(null);
    try {
      const scores: CandidateScore[] = simCandidates.map((c) => ({
        candidateId: c.modelId,
        modelId: c.modelId,
        baseScore: c.score / 100, // 归一化到 0-1
      }));
      const result = engine.applyPreferences(scores);
      setSimResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '模拟失败');
    }
  }, [engine, simCandidates]);

  // 记录演示数据
  const handleRecordDemo = useCallback(() => {
    setError(null);
    try {
      const models = ['claude-sonnet-4.5', 'gpt-5', 'deepseek-v3.2', 'gemini-2.0-pro'];
      const taskTypes: TaskType[] = ['coding', 'writing', 'analysis', 'coding', 'coding'];
      for (let i = 0; i < 5; i++) {
        const winner = models[Math.floor(Math.random() * models.length)];
        const candidates = models.map((m) => ({
          modelId: m,
          originalScore: 70 + Math.random() * 25,
        }));
        engine.recordDecision({
          sessionId: `demo-${Date.now()}-${i}`,
          taskType: taskTypes[i],
          prompt: `Demo task ${i}`,
          candidates,
          selectedModelId: winner,
        });
      }
      // 给最近 3 条记录加反馈
      const all = engine.getRecords();
      const last3 = all.slice(-3);
      last3.forEach((r) => {
        if (Math.random() > 0.3) {
          engine.submitFeedback(r.recordId, 'positive');
        } else if (Math.random() > 0.5) {
          engine.submitFeedback(r.recordId, 'neutral');
        }
      });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : '演示失败');
    }
  }, [engine, refresh]);

  // 重置
  const handleReset = useCallback(() => {
    if (confirm('确认重置所有学习记录和偏好？')) {
      engine.resetPreferences();
      refresh();
    }
  }, [engine, refresh]);

  // 切换算法
  const handleChangeAlgo = useCallback(
    (algo: LearningAlgorithm) => {
      setAlgorithm(algo);
      engine.updateConfig({ algorithm: algo });
    },
    [engine]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="candidate-learning-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[90vw] max-w-6xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <span className="text-white text-sm">🧠</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">候选学习引擎</h2>
              <p className="text-xs text-slate-400">从历史 best-of-N 会话中学习用户偏好</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={algorithm}
              onChange={(e) => handleChangeAlgo(e.target.value as LearningAlgorithm)}
              data-testid="learning-algo"
              className="px-2 py-1 bg-surface-700 text-white text-xs rounded border border-surface-600"
            >
              {(Object.keys(ALGO_LABELS) as LearningAlgorithm[]).map((a) => (
                <option key={a} value={a}>
                  {ALGO_LABELS[a]}
                </option>
              ))}
            </select>
            <button
              onClick={handleRecordDemo}
              data-testid="learning-demo"
              className="px-3 py-1 bg-primary-500 hover:bg-primary-600 text-white text-xs rounded transition"
            >
              生成演示
            </button>
            <button
              onClick={handleReset}
              data-testid="learning-reset"
              className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 text-xs rounded transition"
            >
              重置
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
              data-testid="learning-close"
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
              { key: 'overview', label: '概览' },
              { key: 'preferences', label: '偏好画像' },
              { key: 'records', label: '学习记录' },
              { key: 'simulate', label: '模拟推荐' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              data-testid={`learning-tab-${t.key}`}
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

          {activeTab === 'overview' && <OverviewTab stats={stats} preferences={preferences} config={config} />}
          {activeTab === 'preferences' && <PreferencesTab preferences={preferences} />}
          {activeTab === 'records' && (
            <RecordsTab
              records={records}
              onFeedback={(recordId, fb) => engine.submitFeedback(recordId, fb)}
            />
          )}
          {activeTab === 'simulate' && (
            <SimulateTab
              task={simTask}
              prompt={simPrompt}
              setPrompt={setSimPrompt}
              candidates={simCandidates}
              setCandidates={setSimCandidates}
              result={simResult}
              onSimulate={handleSimulate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ====== Tab 子组件 ======

function OverviewTab({
  stats,
  preferences,
  config,
}: {
  stats: LearningStats;
  preferences: UserPreferenceVector;
  config: LearningConfig;
}) {
  // 从 preferences 提取模型权重（按值降序）
  const sortedModels = Object.entries(preferences.modelPreferences).sort(([, a], [, b]) => b - a);

  // 从 records 计算任务分布
  const taskDist = useMemo(() => {
    const all = Object.values(preferences.taskPreferences);
    return all;
  }, [preferences]);

  return (
    <div className="space-y-4" data-testid="learning-overview">
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="总记录" value={stats.totalRecords.toString()} />
        <MetricCard label="已学习模型" value={sortedModels.length.toString()} />
        <MetricCard label="总反馈" value={stats.totalFeedback.toString()} />
        <MetricCard
          label="接受率"
          value={`${(stats.acceptanceRate * 100).toFixed(1)}%`}
          color={stats.acceptanceRate > 0.6 ? 'text-emerald-400' : 'text-white'}
        />
        <MetricCard label="偏好强度" value={stats.preferenceStrength.toFixed(2)} />
        <MetricCard label="Top 模型" value={stats.topModel || '-'} />
        <MetricCard label="Top 任务" value={stats.topTaskType ? TASK_LABELS[stats.topTaskType] : '-'} />
        <MetricCard label="学习算法" value={ALGO_LABELS[config.algorithm]} />
      </div>
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">模型偏好权重（Top 5）</h3>
        <div className="space-y-2">
          {sortedModels.slice(0, 5).map(([model, weight]) => {
            const pct = Math.min(100, weight * 100);
            return (
              <div key={model} className="flex items-center gap-3">
                <span className="text-xs text-slate-300 font-mono w-44 truncate">{model}</span>
                <div className="flex-1 h-2 bg-surface-900 rounded overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-slate-400 w-12 text-right">{weight.toFixed(2)}</span>
              </div>
            );
          })}
          {sortedModels.length === 0 && (
            <EmptyState
              icon="🤖"
              title="暂未学习到任何模型偏好"
              description="当用户选择某个模型完成 best-of-N 任务时，此处将自动累计权重。"
              tone="neutral"
              testId="learning-overview-empty"
              compact
            />
          )}
        </div>
      </div>
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">任务类型偏好</h3>
        <div className="grid grid-cols-5 gap-2">
          {(['coding', 'writing', 'analysis', 'learning', 'general'] as TaskType[]).map((t, i) => {
            const c = taskDist[i] || 0;
            return (
              <div key={t} className="bg-surface-900 border border-surface-700 rounded p-2 text-center">
                <div className="text-xs text-slate-400">{TASK_LABELS[t]}</div>
                <div className="text-lg font-bold text-white">{c.toFixed(2)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PreferencesTab({ preferences }: { preferences: UserPreferenceVector }) {
  return (
    <div className="space-y-4" data-testid="learning-preferences">
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">用户偏好画像</h3>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-400">用户 ID</div>
            <div className="text-white font-mono">{preferences.userId}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">总决策数</div>
            <div className="text-white">{preferences.totalDecisions}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">最近更新</div>
            <div className="text-white">{new Date(preferences.lastUpdated).toLocaleString()}</div>
          </div>
        </div>
      </div>
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">模型偏好</h3>
        {Object.keys(preferences.modelPreferences).length === 0 ? (
          <EmptyState
            icon="🎯"
            title="暂未形成模型偏好画像"
            description="记录足够多的 best-of-N 决策后，会自动生成排序后的模型偏好权重。"
            tone="neutral"
            testId="learning-preferences-empty"
            compact
          />
        ) : (
          <div className="space-y-2">
            {Object.entries(preferences.modelPreferences)
              .sort(([, a], [, b]) => b - a)
              .map(([m, w]) => (
                <div key={m} className="flex items-center gap-3">
                  <span className="text-xs text-slate-300 font-mono w-44 truncate">{m}</span>
                  <div className="flex-1 h-2 bg-surface-900 rounded overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500"
                      style={{ width: `${Math.min(100, w * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 w-12 text-right">{w.toFixed(2)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">任务偏好</h3>
        <div className="grid grid-cols-5 gap-2">
          {(['coding', 'writing', 'analysis', 'learning', 'general'] as TaskType[]).map((t) => (
            <div key={t} className="bg-surface-900 border border-surface-700 rounded p-2 text-center">
              <div className="text-xs text-slate-400">{TASK_LABELS[t]}</div>
              <div className="text-lg font-bold text-white">
                {(preferences.taskPreferences[t] || 0).toFixed(2)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RecordsTab({
  records,
  onFeedback,
}: {
  records: CandidateLearningRecord[];
  onFeedback: (recordId: string, fb: 'positive' | 'negative' | 'neutral') => void;
}) {
  if (records.length === 0) {
    return (
      <EmptyState
        icon="📒"
        title="暂无学习记录"
        description="点击右上「生成演示」可快速生成 5 条样例数据，或在真实 best-of-N 会话中自动累积。"
        tone="info"
        testId="learning-records-empty"
        action={{
          label: '生成演示',
          onClick: () => {
            // 触发父组件的演示按钮
            const btn = document.querySelector(
              '[data-testid="learning-demo"]'
            ) as HTMLButtonElement | null;
            btn?.click();
          },
          variant: 'primary',
          testId: 'learning-records-empty-demo',
        }}
        compact
      />
    );
  }
  return (
    <div className="space-y-2" data-testid="learning-records">
      {records.map((r) => (
        <div key={r.recordId} className="bg-surface-800 border border-surface-700 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                {TASK_LABELS[r.taskType]}
              </span>
              <span className="text-sm text-white font-mono">{r.selectedModelId}</span>
              <span className="text-xs text-slate-500">·</span>
              <span className="text-xs text-slate-400">
                {new Date(r.createdAt).toLocaleTimeString()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {r.feedback ? (
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border ${FEEDBACK_COLORS[r.feedback]}`}
                >
                  {FEEDBACK_LABELS[r.feedback]}
                </span>
              ) : (
                <>
                  <button
                    onClick={() => onFeedback(r.recordId, 'positive')}
                    className="text-xs px-1.5 py-0.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded"
                    data-testid={`feedback-positive-${r.recordId}`}
                  >
                    👍
                  </button>
                  <button
                    onClick={() => onFeedback(r.recordId, 'negative')}
                    className="text-xs px-1.5 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 rounded"
                    data-testid={`feedback-negative-${r.recordId}`}
                  >
                    👎
                  </button>
                  <button
                    onClick={() => onFeedback(r.recordId, 'neutral')}
                    className="text-xs px-1.5 py-0.5 bg-slate-500/20 hover:bg-slate-500/30 text-slate-300 rounded"
                    data-testid={`feedback-neutral-${r.recordId}`}
                  >
                    ➖
                  </button>
                </>
              )}
            </div>
          </div>
          {r.promptKeywords && r.promptKeywords.length > 0 && (
            <div className="text-xs text-slate-400 mb-1 truncate">
              关键词: {r.promptKeywords.join(', ')}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {r.candidates.map((c) => (
              <span
                key={c.modelId}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  c.selected
                    ? 'bg-violet-500/30 text-violet-200 border border-violet-500/40'
                    : 'bg-surface-700 text-slate-400'
                }`}
              >
                {c.modelId} {c.finalScore.toFixed(1)}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SimulateTab({
  task,
  prompt,
  setPrompt,
  candidates,
  setCandidates,
  result,
  onSimulate,
}: {
  task: TaskType;
  prompt: string;
  setPrompt: (s: string) => void;
  candidates: Array<{ modelId: string; score: number }>;
  setCandidates: (c: Array<{ modelId: string; score: number }>) => void;
  result: AdjustedScore[] | null;
  onSimulate: () => void;
}) {
  void task;
  return (
    <div className="space-y-4" data-testid="learning-simulate">
      <div>
        <label className="block text-xs text-slate-300 mb-1">Prompt（用于提取关键词）</label>
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：实现一个 TypeScript 函数..."
          className="w-full px-2 py-1.5 bg-surface-800 border border-surface-600 rounded text-white text-sm"
          data-testid="sim-prompt"
        />
      </div>
      <div className="bg-surface-800 border border-surface-700 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-white mb-2">候选评分（原始 0-100）</h4>
        <div className="space-y-2">
          {candidates.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-xs text-slate-300 font-mono w-44 truncate">{c.modelId}</span>
              <input
                type="number"
                min={0}
                max={100}
                value={c.score}
                onChange={(e) => {
                  const next = [...candidates];
                  next[i] = { ...c, score: Number(e.target.value) };
                  setCandidates(next);
                }}
                className="w-20 px-2 py-1 bg-surface-900 border border-surface-700 rounded text-white text-sm"
                data-testid={`sim-score-${i}`}
              />
            </div>
          ))}
        </div>
        <button
          onClick={onSimulate}
          data-testid="sim-run"
          className="mt-3 px-3 py-1.5 bg-primary-500 hover:bg-primary-600 text-white text-sm rounded transition"
        >
          应用学习偏好
        </button>
      </div>
      {result && (
        <div className="bg-surface-800 border border-surface-700 rounded-lg p-3" data-testid="sim-result">
          <h4 className="text-sm font-semibold text-white mb-2">调整后结果</h4>
          <div className="space-y-2">
            {result.map((r, i) => {
              const orig = r.originalScore * 100;
              const finalPct = r.adjustedScore * 100;
              const delta = finalPct - orig;
              const isWinner = i === 0;
              return (
                <div
                  key={r.candidateId}
                  className={`p-2 rounded border ${
                    isWinner
                      ? 'bg-violet-500/10 border-violet-500/40'
                      : 'bg-surface-900 border-surface-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-white font-mono">
                      {r.candidateId} {isWinner && '🏆'}
                    </span>
                    <span
                      className={`text-sm font-bold ${
                        delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-400'
                      }`}
                    >
                      {finalPct.toFixed(1)} ({delta > 0 ? '+' : ''}
                      {delta.toFixed(1)})
                    </span>
                  </div>
                  {r.explanation.reasons.length > 0 && (
                    <ul className="text-xs text-slate-400 space-y-0.5">
                      {r.explanation.reasons.map((rs, j) => (
                        <li key={j}>· {rs}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
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
