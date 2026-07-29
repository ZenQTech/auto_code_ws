/**
 * # ============================================================
 * # ContextWindowMeter 组件 (v6.40.0 Cycle 18 G18-03)
 * # ============================================================
 * # 核心作用：显示 Composer 上下文窗口使用情况
 * # 功能：
 * #   - 实时 token 进度条
 * #   - 摘要触发提示
 * #   - 手动摘要按钮
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 18 G18-03 初次创建
 * # ============================================================
 */

import { useState, useEffect } from 'react';
import {
  estimateConversationTokens,
  Summarizer,
  type SummaryConfig,
  type ConversationItem,
  type Summary,
} from '../utils/composerEngine.summary';

export interface ContextWindowMeterProps {
  /** 当前会话项 */
  items: ConversationItem[];
  /** 摘要配置 */
  config?: Partial<SummaryConfig>;
  /** 摘要回调 */
  onSummarize?: (summary: Summary) => void;
  /** 摘要历史 */
  history?: Summary[];
  className?: string;
}

export function ContextWindowMeter({
  items,
  config,
  onSummarize,
  history = [],
  className = '',
}: ContextWindowMeterProps) {
  const [summarizer] = useState(() => new Summarizer(config));
  const [tokens, setTokens] = useState(0);
  const [threshold, setThreshold] = useState(summarizer.getConfig().triggerThreshold);
  const [isSummarizing, setIsSummarizing] = useState(false);

  useEffect(() => {
    setTokens(estimateConversationTokens(items));
    setThreshold(summarizer.getConfig().triggerThreshold);
  }, [items, summarizer]);

  const percent = Math.min(100, (tokens / threshold) * 100);
  const isWarning = percent > 70;
  const isCritical = percent > 90;

  const handleSummarize = () => {
    setIsSummarizing(true);
    try {
      const summary = summarizer.summarize(items, { force: true });
      if (summary) {
        onSummarize?.(summary);
      }
    } finally {
      setIsSummarizing(false);
    }
  };

  const barColor = isCritical
    ? 'bg-red-500'
    : isWarning
    ? 'bg-yellow-500'
    : 'bg-hermes-500';

  return (
    <div
      data-testid="context-window-meter"
      data-tokens={tokens}
      data-threshold={threshold}
      data-percent={percent}
      className={`flex flex-col gap-1 p-2 bg-surface-800/50 rounded text-xs ${className}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-surface-300 font-mono">
          {tokens.toLocaleString()} / {threshold.toLocaleString()} tokens
        </span>
        {(isWarning || isCritical) && (
          <button
            data-testid="context-meter-summarize"
            onClick={handleSummarize}
            disabled={isSummarizing}
            className={`px-2 py-0.5 rounded text-white ${
              isCritical ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700'
            } disabled:opacity-50`}
          >
            {isSummarizing ? '摘要中...' : '立即摘要'}
          </button>
        )}
      </div>

      <div className="relative h-1.5 bg-surface-700 rounded overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {history.length > 0 && (
        <div data-testid="context-meter-history-info" className="text-surface-500 text-[10px]">
          已有 {history.length} 次摘要
        </div>
      )}
    </div>
  );
}

// ============================================================
// SummarizationHistory 组件
// ============================================================

export interface SummarizationHistoryProps {
  summaries: Summary[];
  onApply?: (summary: Summary) => void;
  onDelete?: (id: string) => void;
  className?: string;
}

export function SummarizationHistory({
  summaries,
  onApply,
  onDelete,
  className = '',
}: SummarizationHistoryProps) {
  if (summaries.length === 0) {
    return (
      <div
        data-testid="summarization-history-empty"
        className={`p-4 text-center text-surface-500 text-sm ${className}`}
      >
        暂无摘要历史
      </div>
    );
  }

  return (
    <div
      data-testid="summarization-history"
      className={`flex flex-col gap-2 ${className}`}
    >
      <h3 className="text-sm font-semibold text-surface-200 px-2">摘要历史</h3>
      <div className="flex flex-col gap-2 max-h-96 overflow-y-auto">
        {summaries
          .slice()
          .reverse()
          .map((s) => (
            <SummaryCard key={s.id} summary={s} onApply={onApply} onDelete={onDelete} />
          ))}
      </div>
    </div>
  );
}

function SummaryCard({
  summary,
  onApply,
  onDelete,
}: {
  summary: Summary;
  onApply?: (s: Summary) => void;
  onDelete?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      data-testid={`summary-card-${summary.id}`}
      className="border border-surface-700 rounded p-2 bg-surface-800/50"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="text-xs text-surface-300">
            {new Date(summary.createdAt).toLocaleString()}
          </div>
          <div className="text-[10px] text-surface-500 mt-1">
            策略: {summary.strategy} • 减少: {(summary.stats.reductionRatio * 100).toFixed(0)}%
          </div>
        </div>
        <div className="flex gap-1">
          <button
            data-testid={`summary-toggle-${summary.id}`}
            onClick={() => setExpanded(!expanded)}
            className="px-2 py-0.5 text-surface-400 hover:text-surface-100"
          >
            {expanded ? '收起' : '展开'}
          </button>
          {onApply && (
            <button
              data-testid={`summary-apply-${summary.id}`}
              onClick={() => onApply(summary)}
              className="px-2 py-0.5 text-hermes-500 hover:text-hermes-400"
            >
              应用
            </button>
          )}
          {onDelete && (
            <button
              data-testid={`summary-delete-${summary.id}`}
              onClick={() => onDelete(summary.id)}
              className="px-2 py-0.5 text-red-400 hover:text-red-300"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <pre
          data-testid={`summary-text-${summary.id}`}
          className="mt-2 text-[10px] text-surface-300 whitespace-pre-wrap font-mono bg-surface-900 p-2 rounded"
        >
          {summary.text}
        </pre>
      )}
    </div>
  );
}
