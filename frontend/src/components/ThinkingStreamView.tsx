/**
 * # ============================================================
 * # ThinkingStreamView 组件 (v1.0.0)
 * # Cycle 67 G67-01
 * # ====================================
 * # 核心作用：实时可视化 LLM 思考过程
 * # 功能：
 * #   1. 显示当前 running step（展开 + 脉冲动效）
 * #   2. 历史 step 列表（折叠/展开）
 * #   3. 统计：总 step / 累计 tokens / 累计耗时
 * #   4. 操作：清空 / 刷新 / 导出
 * #   5. WebSocket 连接状态指示
 * #   6. 错误提示与重连
 * # 输入参数：
 * #   - sessionId: string
 * #   - wsUrl?: string
 * #   - maxVisible?: number 默认 5
 * #   - collapsible?: boolean 默认 true
 * #   - showMetadata?: boolean 默认 true
 * #   - onStepClick?: (step) => void
 * #   - testId?: string
 * # 输出结果：纯 UI 组件
 * # 对标：Codex PR #6006 reasoning stream
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 67 G67-01 初次创建
 * # ====================================
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useThinkingStream, type ThinkingStep } from '../hooks/useThinkingStream';

// ============================================================
// 类型
// ====================================

export interface ThinkingStreamViewProps {
  sessionId: string;
  wsUrl?: string;
  /** 最多同时显示的历史 step 数量 */
  maxVisible?: number;
  /** 是否允许折叠历史 */
  collapsible?: boolean;
  /** 是否显示 step 元信息（token / 耗时） */
  showMetadata?: boolean;
  /** 点击 step 回调 */
  onStepClick?: (step: ThinkingStep) => void;
  /** 自动滚动到当前 step */
  autoScroll?: boolean;
  /** 测试 ID */
  testId?: string;
}

// ============================================================
// 工具函数
// ====================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

function formatTimestamp(ts: number): string {
  if (!ts) return '--';
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function truncateContent(s: string, n: number = 100): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + '...';
}

// ============================================================
// 子组件：CurrentStepCard
// ============================================================

interface CurrentStepCardProps {
  step: ThinkingStep;
  showMetadata: boolean;
}

const CurrentStepCard: React.FC<CurrentStepCardProps> = ({
  step,
  showMetadata,
}) => (
  <div
    className="p-3 rounded-lg border border-hermes-500
               bg-hermes-50/30 dark:bg-hermes-900/20
               animate-pulse-subtle"
    data-testid="thinking-current-card"
  >
    <div className="flex items-center justify-between mb-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-hermes-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-hermes-500"></span>
        </span>
        <span className="text-xs font-medium text-hermes-600 dark:text-hermes-400">
          思考中...
        </span>
        <span className="text-[10px] text-[var(--text-tertiary)]">
          Step #{step.step_index + 1}
        </span>
      </div>
      {showMetadata && (
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]">
          {step.model && <span>{step.model}</span>}
          <span>·</span>
          <span>{step.tokens} tokens</span>
        </div>
      )}
    </div>
    <div
      className="text-xs text-[var(--text-primary)]
                 font-mono whitespace-pre-wrap break-words
                 max-h-48 overflow-y-auto leading-relaxed"
      data-testid="thinking-current-content"
    >
      {step.content || (
        <span className="text-[var(--text-tertiary)] italic">
          等待第一个 token...
        </span>
      )}
      <span className="inline-block w-1.5 h-3 ml-0.5 bg-hermes-500 animate-blink" />
    </div>
  </div>
);

// ============================================================
// 子组件：HistoryStepItem
// ============================================================

interface HistoryStepItemProps {
  step: ThinkingStep;
  expanded: boolean;
  onToggle: () => void;
  onClick?: (step: ThinkingStep) => void;
  showMetadata: boolean;
}

const HistoryStepItem: React.FC<HistoryStepItemProps> = ({
  step,
  expanded,
  onToggle,
  onClick,
  showMetadata,
}) => {
  const statusBadge = useMemo(() => {
    if (step.status === 'completed') {
      return (
        <span className="px-1.5 py-0.5 text-[9px] rounded
                       bg-green-500/20 text-green-600 dark:text-green-400">
          ✓
        </span>
      );
    }
    if (step.status === 'truncated') {
      return (
        <span className="px-1.5 py-0.5 text-[9px] rounded
                       bg-yellow-500/20 text-yellow-600 dark:text-yellow-400">
          截断
        </span>
      );
    }
    return null;
  }, [step.status]);

  return (
    <div
      className="rounded-md border border-[var(--border-color)]
                 bg-[var(--bg-elevated)]/50
                 hover:border-hermes-400 transition-colors"
      data-testid="thinking-history-item"
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-2.5 py-1.5 flex items-center
                   justify-between text-left text-[11px]
                   hover:bg-[var(--bg-elevated)] transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <span
            className="text-[var(--text-tertiary)] transition-transform"
            style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0)' }}
          >
            ▶
          </span>
          {statusBadge}
          <span className="text-[var(--text-secondary)] font-medium">
            Step #{step.step_index + 1}
          </span>
          {step.summary && !expanded && (
            <span className="text-[var(--text-tertiary)] truncate text-[10px]">
              · {truncateContent(step.summary, 30)}
            </span>
          )}
        </div>
        {showMetadata && (
          <div className="flex items-center gap-1.5 text-[9px] text-[var(--text-tertiary)] flex-shrink-0">
            <span>{formatTimestamp(step.started_at)}</span>
            {step.tokens > 0 && <span>· {step.tokens}t</span>}
            {step.duration_ms > 0 && <span>· {formatDuration(step.duration_ms)}</span>}
          </div>
        )}
      </button>
      {expanded && (
        <div
          className="px-2.5 py-2 border-t border-[var(--border-color)]
                     text-[11px] text-[var(--text-primary)]
                     font-mono whitespace-pre-wrap break-words
                     max-h-64 overflow-y-auto"
          onClick={() => onClick?.(step)}
          data-testid="thinking-history-content"
        >
          {step.summary && (
            <div className="mb-1.5 text-[10px] text-hermes-500 not-italic font-sans">
              摘要：{step.summary}
            </div>
          )}
          <div className="leading-relaxed">
            {step.content}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// 主组件
// ====================================

export const ThinkingStreamView: React.FC<ThinkingStreamViewProps> = ({
  sessionId,
  wsUrl,
  maxVisible = 5,
  collapsible = true,
  showMetadata = true,
  onStepClick,
  testId = 'thinking-stream-view',
}) => {
  const {
    steps,
    currentStep,
    isStreaming,
    totalSteps,
    totalTokens,
    totalDurationMs,
    stats,
    loading,
    error,
    connected,
    refresh,
    clear,
    exportThinking,
    reconnect,
    clearError,
  } = useThinkingStream({
    sessionId,
    wsUrl,
    autoConnect: !!wsUrl,
  });

  const [showHistory, setShowHistory] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [exportFormat, setExportFormat] = useState<'json' | 'markdown'>('markdown');
  const [exportPreview, setExportPreview] = useState<string | null>(null);

  const handleToggleExpand = useCallback((stepId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const content = await exportThinking(exportFormat);
      setExportPreview(content);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[ThinkingStreamView] export failed:', err);
    }
  }, [exportThinking, exportFormat]);

  // 限制显示的历史 step 数量
  const visibleSteps = useMemo(
    () => steps.slice(0, maxVisible),
    [steps, maxVisible],
  );

  return (
    <div
      className="flex flex-col h-full bg-[var(--bg-panel)]
                  text-[var(--text-primary)]"
      data-testid={testId}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-[var(--border-color)]
                      flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm">🧠</span>
          <h3 className="text-xs font-semibold">思考流</h3>
          {isStreaming && (
            <span
              className="px-1.5 py-0.5 text-[9px] rounded
                         bg-hermes-500/20 text-hermes-500
                         flex items-center gap-1"
              data-testid="thinking-streaming-badge"
            >
              <span className="w-1 h-1 rounded-full bg-hermes-500 animate-pulse" />
              进行中
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {connected !== undefined && (
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? 'bg-green-500' : 'bg-gray-400'
              }`}
              title={connected ? '已连接' : '未连接'}
              data-testid="thinking-connection-indicator"
            />
          )}
          <button
            type="button"
            onClick={() => void refresh()}
            className="px-1.5 py-0.5 text-[10px] rounded
                       hover:bg-[var(--bg-elevated)]
                       text-[var(--text-secondary)]"
            title="刷新"
            data-testid="thinking-refresh-btn"
          >
            🔄
          </button>
          <button
            type="button"
            onClick={reconnect}
            className="px-1.5 py-0.5 text-[10px] rounded
                       hover:bg-[var(--bg-elevated)]
                       text-[var(--text-secondary)]"
            title="重连"
            data-testid="thinking-reconnect-btn"
          >
            📡
          </button>
          <button
            type="button"
            onClick={handleExport}
            className="px-1.5 py-0.5 text-[10px] rounded
                       hover:bg-[var(--bg-elevated)]
                       text-[var(--text-secondary)]"
            title="导出"
            data-testid="thinking-export-btn"
          >
            ⬇
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('确定清空所有思考历史？')) {
                void clear();
              }
            }}
            className="px-1.5 py-0.5 text-[10px] rounded
                       hover:bg-red-500/20 text-red-500"
            title="清空"
            data-testid="thinking-clear-btn"
          >
            🗑
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="px-3 py-1.5 border-b border-[var(--border-color)]
                      flex items-center gap-3 text-[10px]
                      text-[var(--text-secondary)]
                      bg-[var(--bg-app)]/40 flex-shrink-0">
        <span>总步骤: <strong data-testid="thinking-total-steps">{totalSteps}</strong></span>
        <span>·</span>
        <span>累计 tokens: <strong data-testid="thinking-total-tokens">{totalTokens}</strong></span>
        <span>·</span>
        <span>累计耗时: <strong data-testid="thinking-total-duration">{formatDuration(totalDurationMs)}</strong></span>
        {stats && stats.truncated_steps > 0 && (
          <>
            <span>·</span>
            <span className="text-yellow-500">截断: {stats.truncated_steps}</span>
          </>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          className="px-3 py-1.5 text-[10px]
                     bg-red-500/10 text-red-500
                     border-b border-red-500/30 flex items-center
                     justify-between flex-shrink-0"
          data-testid="thinking-error-banner"
        >
          <span>⚠ {error}</span>
          <button
            type="button"
            onClick={clearError}
            className="text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Export Preview Modal */}
      {exportPreview && (
        <div
          className="absolute inset-0 z-50 bg-black/60
                     flex items-center justify-center p-3"
          onClick={() => setExportPreview(null)}
          data-testid="thinking-export-preview"
        >
          <div
            className="bg-[var(--bg-panel)] rounded-lg shadow-2xl
                       max-w-2xl max-h-[80vh] flex flex-col
                       border border-[var(--border-color)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-[var(--border-color)]
                            flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">导出预览</span>
                <select
                  value={exportFormat}
                  onChange={(e) => setExportFormat(e.target.value as 'json' | 'markdown')}
                  className="text-[10px] px-1.5 py-0.5 rounded
                             bg-[var(--bg-elevated)] border
                             border-[var(--border-color)]"
                >
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <button
                type="button"
                onClick={() => setExportPreview(null)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>
            <pre className="px-3 py-2 text-[10px] font-mono
                            overflow-auto flex-1 whitespace-pre-wrap
                            max-h-96">
              {exportPreview}
            </pre>
            <div className="px-3 py-2 border-t border-[var(--border-color)]
                            flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(exportPreview);
                }}
                className="px-2 py-1 text-[10px] rounded
                           bg-hermes-500 text-white
                           hover:bg-hermes-600"
              >
                📋 复制
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* Current Step */}
        {currentStep && (
          <CurrentStepCard step={currentStep} showMetadata={showMetadata} />
        )}

        {/* Loading */}
        {loading && totalSteps === 0 && !currentStep && (
          <div className="text-center py-8 text-[var(--text-tertiary)] text-xs">
            加载中...
          </div>
        )}

        {/* Empty State */}
        {!loading && !currentStep && totalSteps === 0 && (
          <div
            className="text-center py-8 px-4
                       text-[var(--text-tertiary)] text-[11px]"
            data-testid="thinking-empty-state"
          >
            <div className="text-2xl mb-2 opacity-50">🧠</div>
            <div>暂无思考记录</div>
            <div className="mt-1 text-[10px]">
              启动 Agent 任务后，思考过程会实时显示在此
            </div>
          </div>
        )}

        {/* History Header */}
        {collapsible && totalSteps > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className="w-full px-2 py-1 text-[10px] font-medium
                       text-[var(--text-secondary)]
                       flex items-center gap-1
                       hover:bg-[var(--bg-elevated)] rounded
                       transition-colors"
            data-testid="thinking-history-toggle"
          >
            <span
              className="transition-transform"
              style={{ transform: showHistory ? 'rotate(90deg)' : 'rotate(0)' }}
            >
              ▶
            </span>
            历史步骤 ({totalSteps})
            {totalSteps > maxVisible && (
              <span className="text-[9px] text-[var(--text-tertiary)]">
                (显示最近 {maxVisible} 条)
              </span>
            )}
          </button>
        )}

        {/* History List */}
        {showHistory && visibleSteps.length > 0 && (
          <div className="space-y-1.5" data-testid="thinking-history-list">
            {visibleSteps.map((step) => (
              <HistoryStepItem
                key={step.step_id}
                step={step}
                expanded={expandedIds.has(step.step_id)}
                onToggle={() => handleToggleExpand(step.step_id)}
                onClick={onStepClick}
                showMetadata={showMetadata}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ThinkingStreamView;
