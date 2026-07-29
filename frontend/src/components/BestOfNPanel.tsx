/**
 * # ============================================================
 * # BestOfNPanel - Best-of-N 多模型对比面板 (v1.0.0 Cycle 19 G19-02)
 * # ============================================================
 * # 核心作用：并行调用 N 个 LLM 模型，对比结果
 * # 运行流程：
 * #   1. 用户选择模型 + 输入 prompt
 * #   2. 点击运行，启动 MultiModelExecutor
 * #   3. 候选卡片实时显示流式输出
 * #   4. 完成后显示对比表 + 操作按钮（选择/重试/合并）
 * # 输入参数：isOpen / onClose / onSelect
 * # 输出结果：JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 19 G19-02 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  getMultiModelExecutor,
} from '../utils/multiModelExecutor';
import {
  type BestOfNCandidate,
  type BestOfNRequest,
  type ComparisonRow,
  DEFAULT_MODELS,
  calculateCost,
  estimateTokens,
} from '../utils/bestOfNTypes';

export interface BestOfNPanelProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt?: string;
  onSelect?: (candidate: BestOfNCandidate) => void;
  onMerge?: (candidates: BestOfNCandidate[]) => void;
}

export function BestOfNPanel({ isOpen, onClose, initialPrompt, onSelect, onMerge }: BestOfNPanelProps) {
  const executor = useMemo(() => getMultiModelExecutor(), []);
  const [prompt, setPrompt] = useState(initialPrompt ?? '');
  const [selectedModels, setSelectedModels] = useState<string[]>(['claude-sonnet-4.5', 'gpt-5', 'deepseek-v3.2']);
  const [candidates, setCandidates] = useState<BestOfNCandidate[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [columns, setColumns] = useState<2 | 3>(2);
  const taskIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  // 订阅事件
  useEffect(() => {
    if (!isOpen) return;
    const offStart = executor.on('start', (event) => {
      if (event.taskId !== taskIdRef.current) return;
      setCandidates(prev => {
        const existing = prev.find(c => c.model === event.model);
        if (existing) {
          return prev.map(c => c.model === event.model ? { ...c, status: 'running' } : c);
        }
        return [...prev, {
          id: event.model + '_' + event.taskId,
          model: event.model,
          status: 'running',
          text: '',
          inputTokens: 0,
          outputTokens: 0,
          cost: 0,
        }];
      });
    });

    const offDelta = executor.on('delta', (event) => {
      if (event.taskId !== taskIdRef.current) return;
      setCandidates(prev => prev.map(c =>
        c.model === event.model
          ? { ...c, text: c.text + event.text, outputTokens: estimateTokens(c.text + event.text), cost: calculateCost(estimateTokens(prompt), estimateTokens(c.text + event.text), c.model), status: 'streaming' }
          : c
      ));
    });

    const offDone = executor.on('done', (event) => {
      if (event.taskId !== taskIdRef.current) return;
      setCandidates(prev => prev.map(c =>
        c.model === event.candidate.model ? event.candidate : c
      ));
    });

    const offError = executor.on('error', (event) => {
      if (event.taskId !== taskIdRef.current) return;
      setCandidates(prev => prev.map(c =>
        c.model === event.model
          ? { ...c, status: 'failed', error: event.error }
          : c
      ));
    });

    const offAll = executor.on('all-complete', (event) => {
      if (event.taskId !== taskIdRef.current) return;
      setIsRunning(false);
      setCandidates(event.result.candidates);
    });

    return () => {
      offStart();
      offDelta();
      offDone();
      offError();
      offAll();
    };
  }, [executor, isOpen, prompt]);

  const handleRun = useCallback(async () => {
    if (!prompt.trim() || selectedModels.length < 2) return;
    setCandidates(selectedModels.map(model => ({
      id: model + '_init',
      model,
      status: 'pending',
      text: '',
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
    })));
    setIsRunning(true);
    const request: BestOfNRequest = {
      prompt,
      models: selectedModels,
    };
    const result = await executor.execute(request);
    taskIdRef.current = result.taskId;
  }, [executor, prompt, selectedModels]);

  const handleCancel = useCallback(() => {
    executor.cancel();
    setIsRunning(false);
  }, [executor]);

  const handleRetry = useCallback(async (model: string) => {
    if (!taskIdRef.current) return;
    const candidate = candidates.find(c => c.model === model);
    if (!candidate) return;
    setCandidates(prev => prev.map(c =>
      c.model === model ? { ...c, status: 'pending', text: '', error: undefined } : c
    ));
    const newCandidate = await executor.retry(taskIdRef.current, candidate, {
      prompt,
      models: [model],
    });
    setCandidates(prev => prev.map(c => c.model === model ? newCandidate : c));
  }, [executor, candidates, prompt]);

  const toggleModel = useCallback((modelId: string) => {
    setSelectedModels(prev => {
      if (prev.includes(modelId)) {
        if (prev.length <= 2) return prev; // 至少 2 个
        return prev.filter(m => m !== modelId);
      }
      if (prev.length >= 5) return prev; // 最多 5 个
      return [...prev, modelId];
    });
  }, []);

  // 构建对比表
  const comparisonTable = useMemo<ComparisonRow[]>(() => {
    return candidates.map(c => ({
      model: c.model,
      status: c.status,
      duration: c.duration ?? 0,
      outputTokens: c.outputTokens,
      cost: c.cost,
      textLength: c.text.length,
      hasCode: /```/.test(c.text) || /<[a-z][^>]*>/.test(c.text),
      hasMarkdown: /^#|^\*|^\d+\./.test(c.text),
    }));
  }, [candidates]);

  const totalCost = useMemo(() => candidates.reduce((sum, c) => sum + c.cost, 0), [candidates]);
  const successCount = candidates.filter(c => c.status === 'done').length;

  if (!isOpen) return null;

  return (
    <div
      data-testid="best-of-n-panel"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isRunning) onClose();
      }}
    >
      <div className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700">
          <div>
            <h2 className="text-lg font-semibold text-surface-50">Best-of-N 多模型对比</h2>
            <p className="text-xs text-surface-400 mt-1">
              并行调用 {selectedModels.length} 个模型 · 成功 {successCount}/{candidates.length} · 总成本 ¥{totalCost.toFixed(4)}
            </p>
          </div>
          <button
            data-testid="best-of-n-close"
            onClick={onClose}
            disabled={isRunning}
            className="text-surface-400 hover:text-surface-100 px-2 disabled:opacity-50"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Input */}
        <div className="p-4 border-b border-surface-700 space-y-3">
          <textarea
            data-testid="best-of-n-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="输入 prompt..."
            rows={3}
            className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded text-surface-100 placeholder-surface-500 focus:outline-none focus:border-hermes-500 resize-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-surface-400">模型:</span>
            {DEFAULT_MODELS.map(model => (
              <button
                key={model.id}
                data-testid={`model-toggle-${model.id}`}
                onClick={() => toggleModel(model.id)}
                className={[
                  'px-2 py-1 text-xs rounded border',
                  selectedModels.includes(model.id)
                    ? 'bg-hermes-500/20 border-hermes-500 text-hermes-300'
                    : 'bg-surface-800 border-surface-700 text-surface-400',
                ].join(' ')}
              >
                {model.name}
                {selectedModels.includes(model.id) && ' ✓'}
              </button>
            ))}
            <div className="ml-auto flex gap-2">
              {!isRunning ? (
                <button
                  data-testid="best-of-n-run"
                  onClick={handleRun}
                  disabled={!prompt.trim() || selectedModels.length < 2}
                  className="px-4 py-1.5 text-sm bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  ▶ 运行
                </button>
              ) : (
                <button
                  data-testid="best-of-n-cancel"
                  onClick={handleCancel}
                  className="px-4 py-1.5 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                >
                  ⊘ 取消
                </button>
              )}
              <button
                data-testid="best-of-n-columns-toggle"
                onClick={() => setColumns(c => c === 2 ? 3 : 2)}
                className="px-2 py-1 text-xs bg-surface-800 text-surface-300 rounded hover:bg-surface-700"
              >
                {columns} 列
              </button>
            </div>
          </div>
        </div>

        {/* Candidates Grid */}
        <div className="flex-1 overflow-auto p-4">
          {candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 opacity-30">⚖️</div>
              <p className="text-surface-400 text-sm">选择至少 2 个模型，输入 prompt 后点击运行</p>
            </div>
          ) : (
            <div
              data-testid="best-of-n-grid"
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {candidates.map(candidate => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  onSelect={() => onSelect?.(candidate)}
                  onRetry={() => handleRetry(candidate.model)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Comparison Table */}
        {candidates.length > 0 && !isRunning && (
          <div className="p-4 border-t border-surface-700">
            <h3 className="text-sm font-semibold text-surface-200 mb-2">对比表</h3>
            <table data-testid="best-of-n-comparison-table" className="w-full text-xs">
              <thead>
                <tr className="text-surface-400 border-b border-surface-700">
                  <th className="text-left py-1">模型</th>
                  <th className="text-left py-1">状态</th>
                  <th className="text-right py-1">耗时</th>
                  <th className="text-right py-1">输出 tokens</th>
                  <th className="text-right py-1">成本</th>
                  <th className="text-left py-1">特性</th>
                </tr>
              </thead>
              <tbody>
                {comparisonTable.map(row => (
                  <tr key={row.model} className="border-b border-surface-800 text-surface-300">
                    <td className="py-1">{row.model}</td>
                    <td className="py-1">{row.status}</td>
                    <td className="py-1 text-right">{row.duration}ms</td>
                    <td className="py-1 text-right">{row.outputTokens}</td>
                    <td className="py-1 text-right">¥{row.cost.toFixed(4)}</td>
                    <td className="py-1">
                      {row.hasCode && <span className="px-1 bg-blue-500/20 text-blue-300 rounded mr-1">code</span>}
                      {row.hasMarkdown && <span className="px-1 bg-green-500/20 text-green-300 rounded">md</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2 mt-3 justify-end">
              <button
                data-testid="best-of-n-merge"
                onClick={() => onMerge?.(candidates.filter(c => c.status === 'done'))}
                disabled={candidates.filter(c => c.status === 'done').length < 2}
                className="px-3 py-1 text-sm bg-purple-500/20 text-purple-300 rounded hover:bg-purple-500/30 disabled:opacity-50"
              >
                合并选中
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface CandidateCardProps {
  candidate: BestOfNCandidate;
  onSelect: () => void;
  onRetry: () => void;
}

const CandidateCard: React.FC<CandidateCardProps> = ({ candidate, onSelect, onRetry }) => {
  const statusBadge = useMemo(() => {
    switch (candidate.status) {
      case 'pending': return { label: '等待', className: 'bg-slate-500/20 text-slate-300' };
      case 'running': return { label: '运行中', className: 'bg-blue-500/20 text-blue-300' };
      case 'streaming': return { label: '生成中', className: 'bg-blue-500/20 text-blue-300' };
      case 'done': return { label: '完成', className: 'bg-green-500/20 text-green-300' };
      case 'failed': return { label: '失败', className: 'bg-red-500/20 text-red-300' };
      case 'cancelled': return { label: '取消', className: 'bg-slate-500/20 text-slate-400' };
    }
  }, [candidate.status]);

  return (
    <div
      data-testid={`candidate-card-${candidate.model}`}
      data-status={candidate.status}
      className="bg-surface-800/50 border border-surface-700 rounded p-3 flex flex-col"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-surface-100">{candidate.model}</span>
        <span className={['px-1.5 py-0.5 rounded text-xs', statusBadge.className].join(' ')}>
          {statusBadge.label}
        </span>
      </div>
      <div
        data-testid={`candidate-text-${candidate.model}`}
        className="flex-1 bg-surface-900/50 rounded p-2 text-xs text-surface-200 font-mono whitespace-pre-wrap overflow-auto max-h-64 min-h-[120px]"
      >
        {candidate.text || (candidate.status === 'pending' ? '...' : candidate.error || '')}
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-surface-500">
        <span>
          {candidate.outputTokens} tokens · ¥{candidate.cost.toFixed(4)}
        </span>
        <div className="flex gap-1">
          {candidate.status === 'done' && (
            <button
              data-testid={`candidate-select-${candidate.model}`}
              onClick={onSelect}
              className="px-2 py-0.5 bg-hermes-500/20 text-hermes-300 rounded hover:bg-hermes-500/30"
            >
              选用
            </button>
          )}
          {(candidate.status === 'failed' || candidate.status === 'cancelled') && (
            <button
              data-testid={`candidate-retry-${candidate.model}`}
              onClick={onRetry}
              className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 rounded hover:bg-yellow-500/30"
            >
              ↻ 重试
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BestOfNPanel;
