/**
 * # ============================================================
 * # HookPerformancePanel - Hook 性能分析 UI (v1.0.0 Cycle 22 G22-03)
 * # ============================================================
 * # 核心作用：Hook 执行性能的可视化分析界面
 * # 主要功能：
 * #   1. 性能概览（总执行数/平均耗时/P95/失败率）
 * #   2. 慢节点 TOP 10
 * #   3. 失败率分析
 * #   4. 优化建议列表
 * #   5. 报告导出（json/html/markdown）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 22 G22-03 初次创建
 * #   - 2026-07-29 | v1.0.1 | UI/UX 优化：渐变背景 + 渐入动画 + Esc 关闭
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getHookPerformanceAnalyzer,
  type PerformanceReport,
  type SlowNode,
  type FailureRateReport,
  type OptimizationSuggestion,
  type ReportFormat,
  type SeverityLevel,
} from '../utils/hookPerformanceAnalyzer';

interface HookPerformancePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const SEVERITY_COLORS: Record<SeverityLevel, string> = {
  critical: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  high: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  medium: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  low: 'bg-lime-500/20 text-lime-300 border-lime-500/40',
  info: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
};

const SEVERITY_LABELS: Record<SeverityLevel, string> = {
  critical: '严重',
  high: '高',
  medium: '中',
  low: '低',
  info: '提示',
};

const SUGGESTION_ICONS: Record<string, string> = {
  retry: '🔁',
  'timeout-adjust': '⏱️',
  rewrite: '✏️',
  merge: '🔗',
  split: '✂️',
  disable: '🚫',
  cache: '💾',
  'async-io': '⚡',
};

export function HookPerformancePanel({ isOpen, onClose }: HookPerformancePanelProps) {
  const analyzer = useMemo(() => getHookPerformanceAnalyzer(), []);
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportFormat, setExportFormat] = useState<ReportFormat>('markdown');
  const [activeTab, setActiveTab] = useState<'overview' | 'slow' | 'failure' | 'suggestions' | 'export'>('overview');
  const [error, setError] = useState<string | null>(null);

  // 加载初始模拟数据
  const handleLoadMockData = useCallback(() => {
    setLoading(true);
    setError(null);
    try {
      analyzer.clear();
      analyzer.generateMockData(5, 4, 10);
      const r = analyzer.generateReport();
      setReport(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [analyzer]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 自动加载模拟数据
  useEffect(() => {
    if (isOpen && !report) {
      handleLoadMockData();
    }
  }, [isOpen, report, handleLoadMockData]);

  // 应用建议
  const handleApplySuggestion = useCallback(
    (suggestion: OptimizationSuggestion) => {
      if (!report) return;
      analyzer.markSuggestionApplied(report.reportId, suggestion.suggestionId);
      // 重新生成报告
      const updated = analyzer.getReport(report.reportId);
      if (updated) setReport(updated);
    },
    [analyzer, report]
  );

  // 导出报告
  const handleExport = useCallback(() => {
    if (!report) return;
    try {
      const content = analyzer.exportReport(report.reportId, {
        format: exportFormat,
        includeRawData: true,
        includeOptimizations: true,
      });
      // 创建下载
      const blob = new Blob([content], {
        type: exportFormat === 'json' ? 'application/json' : exportFormat === 'html' ? 'text/html' : 'text/markdown',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hook-perf-${report.reportId}.${exportFormat === 'markdown' ? 'md' : exportFormat}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    }
  }, [analyzer, report, exportFormat]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="hook-performance-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[90vw] max-w-6xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <span className="text-white text-sm">⚡</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Hook 性能分析</h2>
              <p className="text-xs text-slate-400">识别慢节点、失败率、优化建议</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
            aria-label="关闭"
            data-testid="hook-performance-close"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700 bg-surface-800/50">
          {(
            [
              { key: 'overview', label: '概览' },
              { key: 'slow', label: '慢节点' },
              { key: 'failure', label: '失败率' },
              { key: 'suggestions', label: '建议' },
              { key: 'export', label: '导出' },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              data-testid={`hook-perf-tab-${t.key}`}
              className={`px-4 py-2 text-sm transition ${
                activeTab === t.key
                  ? 'text-white border-b-2 border-primary-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto px-3 py-2">
            <button
              onClick={handleLoadMockData}
              disabled={loading}
              data-testid="hook-perf-refresh"
              className="px-3 py-1 bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 text-white text-xs rounded transition"
            >
              {loading ? '生成中...' : '重新生成数据'}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-sm">
              {error}
            </div>
          )}
          {!report ? (
            <div className="text-center text-slate-500 py-12">生成中...</div>
          ) : activeTab === 'overview' ? (
            <OverviewTab report={report} />
          ) : activeTab === 'slow' ? (
            <SlowNodesTab slowNodes={report.slowNodes} />
          ) : activeTab === 'failure' ? (
            <FailureRateTab reports={report.failureReports} />
          ) : activeTab === 'suggestions' ? (
            <SuggestionsTab
              suggestions={report.suggestions}
              onApply={handleApplySuggestion}
            />
          ) : (
            <ExportTab
              format={exportFormat}
              setFormat={setExportFormat}
              onExport={handleExport}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({ report }: { report: PerformanceReport }) {
  return (
    <div className="space-y-4" data-testid="hook-perf-overview">
      {/* 严重度汇总 */}
      <div className="grid grid-cols-5 gap-3">
        {(['critical', 'high', 'medium', 'low', 'info'] as SeverityLevel[]).map((sev) => {
          const key = `${sev}Count` as keyof typeof report.summary;
          const count = report.summary[key];
          return (
            <div
              key={sev}
              className={`rounded-lg p-3 border ${SEVERITY_COLORS[sev]}`}
            >
              <div className="text-xs">{SEVERITY_LABELS[sev]}</div>
              <div className="text-2xl font-bold mt-1">{count}</div>
            </div>
          );
        })}
      </div>

      {/* 关键指标 */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="总执行数" value={report.totalExecutions.toString()} />
        <MetricCard label="总链路数" value={report.totalChains.toString()} />
        <MetricCard label="总 Hook 数" value={report.totalHooks.toString()} />
        <MetricCard label="平均耗时" value={`${report.averageDurationMs}ms`} />
        <MetricCard label="P95 耗时" value={`${report.p95DurationMs}ms`} />
        <MetricCard
          label="失败率"
          value={`${(report.overallFailureRate * 100).toFixed(1)}%`}
          color={report.overallFailureRate > 0.1 ? 'text-rose-400' : 'text-emerald-400'}
        />
        <MetricCard label="慢节点" value={report.slowNodes.length.toString()} />
        <MetricCard label="优化建议" value={report.suggestions.length.toString()} />
      </div>

      {/* 报告 ID */}
      <div className="text-xs text-slate-500 font-mono">
        报告 ID: {report.reportId} · 生成于 {new Date(report.generatedAt).toLocaleString()}
      </div>
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

function SlowNodesTab({ slowNodes }: { slowNodes: SlowNode[] }) {
  if (slowNodes.length === 0) {
    return <div className="text-center text-slate-500 py-12">未检测到慢节点</div>;
  }
  return (
    <div className="space-y-2" data-testid="hook-perf-slow-list">
      {slowNodes.map((node) => (
        <div
          key={node.hookId}
          className={`p-4 rounded-lg border ${SEVERITY_COLORS[node.severity]}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-white font-medium">{node.hookName}</h4>
              <p className="text-xs opacity-70 font-mono">{node.hookId} · {node.hookType}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${SEVERITY_COLORS[node.severity]}`}>
              {SEVERITY_LABELS[node.severity]} · {node.slowdownFactor}x
            </span>
          </div>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-xs opacity-70">平均</div>
              <div className="font-medium">{node.averageDurationMs}ms</div>
            </div>
            <div>
              <div className="text-xs opacity-70">P95</div>
              <div className="font-medium">{node.p95DurationMs}ms</div>
            </div>
            <div>
              <div className="text-xs opacity-70">最大</div>
              <div className="font-medium">{node.maxDurationMs}ms</div>
            </div>
            <div>
              <div className="text-xs opacity-70">执行数</div>
              <div className="font-medium">{node.executionCount}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function FailureRateTab({ reports }: { reports: FailureRateReport[] }) {
  if (reports.length === 0) {
    return <div className="text-center text-slate-500 py-12">未检测到高失败率节点</div>;
  }
  return (
    <div className="space-y-2" data-testid="hook-perf-failure-list">
      {reports.map((r) => (
        <div
          key={r.hookId}
          className={`p-4 rounded-lg border ${SEVERITY_COLORS[r.severity]}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-white font-medium">{r.hookName}</h4>
              <p className="text-xs opacity-70 font-mono">{r.hookId} · {r.hookType}</p>
            </div>
            <span className={`text-xs px-2 py-0.5 rounded ${SEVERITY_COLORS[r.severity]}`}>
              {SEVERITY_LABELS[r.severity]}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs opacity-70">失败率</div>
              <div className="font-medium text-rose-300">{(r.failureRate * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-xs opacity-70">超时率</div>
              <div className="font-medium text-amber-300">{(r.timeoutRate * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-xs opacity-70">总执行</div>
              <div className="font-medium">{r.totalExecutions}</div>
            </div>
          </div>
          {r.commonErrors.length > 0 && (
            <div className="mt-3">
              <div className="text-xs opacity-70 mb-1">常见错误:</div>
              <ul className="text-xs space-y-0.5">
                {r.commonErrors.map((e, i) => (
                  <li key={i} className="font-mono">
                    {e.message} <span className="opacity-60">×{e.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function SuggestionsTab({
  suggestions,
  onApply,
}: {
  suggestions: OptimizationSuggestion[];
  onApply: (s: OptimizationSuggestion) => void;
}) {
  if (suggestions.length === 0) {
    return <div className="text-center text-slate-500 py-12">无优化建议</div>;
  }
  return (
    <div className="space-y-2" data-testid="hook-perf-suggestions-list">
      {suggestions.map((s) => (
        <div
          key={s.suggestionId}
          className={`p-4 rounded-lg border ${SEVERITY_COLORS[s.severity]}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">{SUGGESTION_ICONS[s.type] || '💡'}</span>
              <h4 className="text-white font-medium">{s.title}</h4>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded ${SEVERITY_COLORS[s.severity]}`}>
                {SEVERITY_LABELS[s.severity]}
              </span>
              {s.applied ? (
                <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  ✓ 已应用
                </span>
              ) : (
                <button
                  onClick={() => onApply(s)}
                  className="text-xs px-2 py-0.5 rounded bg-primary-500 hover:bg-primary-600 text-white transition"
                >
                  标记应用
                </button>
              )}
            </div>
          </div>
          <p className="text-sm text-slate-300 mb-2">{s.description}</p>
          <div className="text-xs space-y-1">
            <p><span className="opacity-70">理由:</span> {s.rationale}</p>
            <p><span className="opacity-70">预计提升:</span> {s.estimatedImprovement}</p>
            <p className="font-mono opacity-50">→ {s.targetHookId}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExportTab({
  format,
  setFormat,
  onExport,
}: {
  format: ReportFormat;
  setFormat: (f: ReportFormat) => void;
  onExport: () => void;
}) {
  return (
    <div className="space-y-4 max-w-md" data-testid="hook-perf-export-tab">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">导出格式</label>
        <div className="grid grid-cols-3 gap-2">
          {(['json', 'html', 'markdown'] as ReportFormat[]).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              data-testid={`hook-perf-format-${f}`}
              className={`px-3 py-2 rounded-lg text-sm border transition ${
                format === f
                  ? 'bg-primary-500/20 border-primary-500 text-primary-300'
                  : 'bg-surface-800 border-surface-600 text-slate-400 hover:border-surface-500'
              }`}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={onExport}
        data-testid="hook-perf-export-btn"
        className="w-full px-4 py-3 bg-primary-500 hover:bg-primary-600 text-white font-medium rounded-lg transition"
      >
        导出报告
      </button>
      <p className="text-xs text-slate-500">
        报告将下载到本地，包含完整的慢节点、失败率分析、优化建议。
      </p>
    </div>
  );
}

export default HookPerformancePanel;
