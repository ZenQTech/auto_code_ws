/**
 * # ============================================================
 * # ModelRouterPanel - 智能模型路由面板 (v1.0.0 Cycle 20 G20-02)
 * # ============================================================
 * # 核心作用：根据任务类型 / 复杂度 / 路由模式自动选择最优模型
 * # 运行流程：
 * #   1. 通过 getModelRouter() 单例订阅
 * #   2. 输入任务 prompt，自动分类（code_gen/chat/review/...）
 * #   3. 评估复杂度（1-10），按模式（cost/balance/intelligence）评分
 * #   4. 展示 Top 3 候选模型及决策理由
 * #   5. 支持注册 / 启停 / 路由决策历史
 * # 输入参数：isOpen / onClose
 * # 输出结果：JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 20 G20-02 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getModelRouter,
  classifyTask,
  estimateComplexity,
  type TaskCategory,
  type RoutingMode,
  type ModelInfo,
  type ModelRoute,
  type RouterEvent,
} from '../utils/modelRouter';

export interface ModelRouterPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_LABEL: Record<TaskCategory, string> = {
  code_generation: '代码生成',
  code_review: '代码审查',
  debugging: '调试修复',
  documentation: '文档撰写',
  refactoring: '重构',
  testing: '测试',
  analysis: '分析',
  translation: '翻译',
  explanation: '解释',
  brainstorm: '头脑风暴',
  unknown: '未知',
};

const CATEGORY_ICON: Record<TaskCategory, string> = {
  code_generation: '🎨',
  code_review: '🔍',
  debugging: '🐛',
  documentation: '📝',
  refactoring: '♻️',
  testing: '🧪',
  analysis: '📊',
  translation: '🌐',
  explanation: '💡',
  brainstorm: '💭',
  unknown: '❔',
};

const MODE_LABEL: Record<RoutingMode, string> = {
  cost: '成本优先',
  balance: '平衡模式',
  intelligence: '质量优先',
};

function formatScore(score: number): string {
  return score.toFixed(1);
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

export function ModelRouterPanel({ isOpen, onClose }: ModelRouterPanelProps) {
  const router = useMemo(() => getModelRouter(), []);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [decisionLog, setDecisionLog] = useState<ModelRoute[]>([]);
  const [mode, setMode] = useState<RoutingMode>(router.getMode());
  const [prompt, setPrompt] = useState('');
  const [currentRoute, setCurrentRoute] = useState<ModelRoute | null>(null);

  // 初始化 & 订阅
  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => {
      setModels(router.listModels());
      setDecisionLog(router.getDecisionLog());
    };
    refresh();
    const unsub = (event: RouterEvent) => {
      refresh();
      // eslint-disable-next-line no-console
      console.debug('[ModelRouterPanel] event:', event.type);
    };
    const off = router.on('route-decided', unsub);
    return () => {
      off();
    };
  }, [router, isOpen]);

  const category = useMemo(() => (prompt ? classifyTask(prompt) : null), [prompt]);
  const complexity = useMemo(() => (prompt ? estimateComplexity(prompt) : 0), [prompt]);

  const handleRoute = useCallback(() => {
    if (!prompt.trim()) return;
    try {
      const route = router.route(prompt);
      setCurrentRoute(route);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }
  }, [router, prompt]);

  const handleModeChange = useCallback(
    (newMode: RoutingMode) => {
      router.setMode(newMode);
      setMode(newMode);
    },
    [router],
  );

  const handleToggleModel = useCallback(
    (id: string) => {
      const m = router.getModel(id);
      if (m) {
        router.unregisterModel(id);
        router.registerModel({ ...m, enabled: !m.enabled });
      }
    },
    [router],
  );

  const handleClearLog = useCallback(() => {
    router.clearDecisionLog();
    setDecisionLog([]);
  }, [router]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="model-router-panel"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col animate-in fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700">
          <div>
            <h2 className="text-lg font-semibold text-surface-50">模型路由</h2>
            <p className="text-xs text-surface-400 mt-1">
              {models.filter((m) => m.enabled).length} / {models.length} 模型启用 · 决策 {decisionLog.length} 次
            </p>
          </div>
          <button
            data-testid="model-router-close"
            onClick={onClose}
            className="text-surface-400 hover:text-surface-100 px-2"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Mode Selector */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-surface-700">
          <span className="text-xs text-surface-400">路由模式:</span>
          {(['cost', 'balance', 'intelligence'] as RoutingMode[]).map((m) => (
            <button
              key={m}
              data-testid={`mode-${m}`}
              onClick={() => handleModeChange(m)}
              className={[
                'px-3 py-1 text-xs rounded',
                mode === m
                  ? 'bg-hermes-500 text-white'
                  : 'bg-surface-800 text-surface-300 hover:bg-surface-700',
              ].join(' ')}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
          <button
            data-testid="model-router-clear-log"
            onClick={handleClearLog}
            className="ml-auto px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
          >
            清空决策日志
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Route Test */}
          <div className="bg-surface-800/50 border border-surface-700 rounded p-3">
            <h3 className="text-sm font-semibold text-surface-50 mb-2">路由测试</h3>
            <textarea
              data-testid="model-router-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入任务 prompt，自动分类 + 评估复杂度 + 路由推荐"
              className="w-full px-3 py-2 text-sm bg-surface-900 border border-surface-700 rounded text-surface-200 placeholder-surface-500 focus:outline-none focus:border-hermes-500 resize-none"
              rows={3}
            />
            <div className="flex items-center gap-2 mt-2 text-xs">
              {category && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded">
                  {CATEGORY_ICON[category]} {CATEGORY_LABEL[category]}
                </span>
              )}
              {complexity > 0 && (
                <span className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded">
                  复杂度 {complexity.toFixed(1)}/10
                </span>
              )}
              <button
                data-testid="model-router-route"
                onClick={handleRoute}
                disabled={!prompt.trim()}
                className="ml-auto px-3 py-1 text-xs bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                路由
              </button>
            </div>
            {currentRoute && (
              <div
                data-testid="model-router-result"
                className="mt-3 p-3 bg-surface-900/50 border border-surface-700 rounded space-y-2"
              >
                <div className="text-sm font-medium text-surface-50">
                  推荐模型: <span className="text-hermes-400">{currentRoute.model}</span>
                </div>
                <div className="text-xs text-surface-400">{currentRoute.reason}</div>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {currentRoute.candidates.slice(0, 3).map((c, i) => (
                    <div
                      key={c.model}
                      className={[
                        'p-2 rounded text-xs',
                        i === 0
                          ? 'bg-hermes-500/20 border border-hermes-500/50'
                          : 'bg-surface-800 border border-surface-700',
                      ].join(' ')}
                    >
                      <div className="text-surface-200 font-medium">#{i + 1} {c.model}</div>
                      <div className="text-surface-500 mt-1">评分: {formatScore(c.score)}</div>
                      <div className="text-surface-500">{c.reason}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Models List */}
          <div>
            <h3 className="text-sm font-semibold text-surface-50 mb-2">模型库</h3>
            <div data-testid="model-router-models" className="grid grid-cols-2 gap-2">
              {models.map((m) => (
                <div
                  key={m.id}
                  data-testid={`model-${m.id}`}
                  className={[
                    'p-2 rounded border',
                    m.enabled
                      ? 'bg-surface-800/50 border-surface-700'
                      : 'bg-surface-900/30 border-surface-800 opacity-60',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-surface-100">{m.name}</span>
                    <button
                      data-testid={`model-toggle-${m.id}`}
                      onClick={() => handleToggleModel(m.id)}
                      className={[
                        'text-[10px] px-1.5 py-0.5 rounded',
                        m.enabled
                          ? 'bg-green-500/20 text-green-300'
                          : 'bg-slate-500/20 text-slate-400',
                      ].join(' ')}
                    >
                      {m.enabled ? '已启用' : '已停用'}
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-surface-500 space-y-0.5">
                    <div>能力 {m.capabilityScore}/10 · 速度 {m.speedScore}/10</div>
                    <div>
                      上下文 {(m.contextWindow / 1000).toFixed(0)}k · 输入 {formatCost(m.inputCostPer1k)}/1k · 输出{' '}
                      {formatCost(m.outputCostPer1k)}/1k
                    </div>
                    {m.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {m.specialties.map((s) => (
                          <span key={s} className="px-1 py-0.5 bg-hermes-500/10 text-hermes-300 rounded text-[9px]">
                            {CATEGORY_LABEL[s]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Decision Log */}
          {decisionLog.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-surface-50 mb-2">决策历史（最近 {decisionLog.length} 次）</h3>
              <div data-testid="model-router-log" className="space-y-1">
                {decisionLog.slice(-5).reverse().map((route, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-xs px-2 py-1.5 bg-surface-800/30 rounded"
                  >
                    <span className="text-surface-500">{CATEGORY_ICON[route.category]}</span>
                    <span className="text-surface-200 font-medium">{route.model}</span>
                    <span className="text-surface-500">评分 {formatScore(route.candidates[0]?.score ?? 0)}</span>
                    <span className="text-surface-500">复杂度 {route.complexity.toFixed(1)}</span>
                    <span className="text-surface-500 ml-auto">{new Date(route.timestamp).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ModelRouterPanel;
