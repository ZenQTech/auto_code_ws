/**
 * # ============================================================
 * # PerfOptimizerPanel - AI 主动性能优化 UI (v1.0.0 Cycle 25 G25-03)
 * # ============================================================
 * # 核心作用：PerfOptimizerEngine 的可视化控制面板
 * # 主要功能：
 * #   1. 性能预算配置（max render ms / max state / max lines 等）
 * #   2. 文件选择（粘贴/上传/示例）
 * #   3. 扫描进度展示
 * #   4. 总体评分（圆形进度条 + 等级）
 * #   5. 不必要 hook 列表
 * #   6. 重构建议（before/after diff）
 * #   7. 预算违反情况
 * #   8. 报告导出（JSON / Markdown / Patch）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-03 初次创建
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getDefaultPerfEngine,
  TOTAL_PERF_RULES,
  scoreGrade,
} from '../utils/perfOptimizer';
import {
  DEFAULT_BUDGET,
  PATTERN_ICONS,
  PATTERN_LABELS,
  type HookPattern,
  type PerfBudget,
  type PerfReport,
  type RefactorSuggestion,
} from '../utils/perfOptimizerTypes';
import { EmptyState } from './EmptyState';

interface PerfOptimizerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'hermes.perfOptimizerPanel';

function safeGetItem(key: string): Record<string, unknown> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function safeSetItem(key: string, value: Record<string, unknown>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 忽略
  }
}

const SAMPLE_FILES: Record<string, string> = {
  'src/components/BadList.tsx': `import React, { useState, useMemo, useCallback, useEffect } from 'react';

export function BadList({ items }: { items: any[] }) {
  const [filter, setFilter] = useState('');
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [active, setActive] = useState(true);
  const [error, setError] = useState(null);

  // 不必要的 useMemo（简单过滤）
  const filtered = useMemo(() => items.filter(i => i.active), [items]);

  // useMemo 包装字面量
  const config = useMemo(() => ({ a: 1, b: 2 }), []);

  // useCallback 简单 onClick
  const handleClick = useCallback(() => setOpen(false), []);

  // useCallback 空依赖但引用外部变量
  const handleUpdate = useCallback(() => setCount(id), []);

  // useState 初始值 expensive
  const [parsed, setParsed] = useState(JSON.parse(bigString));

  // useEffect 缺 cleanup
  useEffect(() => {
    setInterval(tick, 1000);
  }, []);

  // 列表使用 index 作为 key
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index}>{item.name}</li>
      ))}
    </ul>
  );
}
`,
  'src/components/Card.tsx': `import React, { memo } from 'react';

const Card = ({ title, content }: any) => {
  return (
    <div className="card">
      <h3>{title}</h3>
      <p>{content}</p>
    </div>
  );
};

// React.memo 无自定义比较函数
export default React.memo(Card);
`,
};

export function PerfOptimizerPanel({ isOpen, onClose }: PerfOptimizerPanelProps) {
  const engine = useMemo(() => getDefaultPerfEngine(), []);
  const [budget, setBudget] = useState<PerfBudget>(engine.getBudget());
  const [files, setFiles] = useState<Record<string, string>>({});
  const [report, setReport] = useState<PerfReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showBudget, setShowBudget] = useState(true);
  const [severityFilter, setSeverityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [copySuccess, setCopySuccess] = useState(false);
  const [stats, setStats] = useState(engine.getStats());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载持久化
  useEffect(() => {
    if (!isOpen) return;
    const stored = safeGetItem(STORAGE_KEY);
    if (stored.budget) setBudget({ ...DEFAULT_BUDGET, ...(stored.budget as Partial<PerfBudget>) });
    if (typeof stored.showBudget === 'boolean') setShowBudget(stored.showBudget);
  }, [isOpen]);

  const persist = useCallback((patch: Record<string, unknown>) => {
    const cur = safeGetItem(STORAGE_KEY);
    safeSetItem(STORAGE_KEY, { ...cur, ...patch });
  }, []);

  // 事件订阅
  useEffect(() => {
    if (!isOpen) return;
    const onScanComplete = (r: PerfReport) => {
      setReport(r);
      setStats(engine.getStats());
    };
    const onError = (err: Error) => {
      setError(err.message);
      setScanning(false);
    };
    engine.on('scan-complete', onScanComplete);
    engine.on('error', onError);
    return () => {
      engine.off('scan-complete', onScanComplete);
      engine.off('error', onError);
    };
  }, [isOpen, engine]);

  // 加载示例
  const loadSample = useCallback(() => {
    setFiles(SAMPLE_FILES);
    setError(null);
    setReport(null);
  }, []);

  // 上传
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setFiles((prev) => ({ ...prev, [file.name]: content }));
    };
    reader.readAsText(file);
  }, []);

  // 更新 budget
  const updateBudget = useCallback(
    (patch: Partial<PerfBudget>) => {
      const newBudget = { ...budget, ...patch };
      setBudget(newBudget);
      engine.setBudget(newBudget);
      persist({ budget: newBudget });
    },
    [budget, engine, persist]
  );

  // 执行扫描
  const runScan = useCallback(async () => {
    setError(null);
    setReport(null);
    if (Object.keys(files).length === 0) {
      setError('请先添加文件');
      return;
    }
    setScanning(true);
    try {
      const r = await engine.scan({ files, budget });
      setReport(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }, [files, engine, budget]);

  // 导出
  const exportReport = useCallback(
    (format: 'json' | 'markdown' | 'patch') => {
      if (!report) return;
      let content = '';
      if (format === 'json') content = engine.exportJSON(report);
      else if (format === 'markdown') content = engine.exportMarkdown(report);
      else content = engine.exportPatch(report.suggestions);
      navigator.clipboard?.writeText(content).then(
        () => {
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2000);
        },
        () => setError('复制失败')
      );
    },
    [report, engine]
  );

  // 快捷键
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === '?') {
        e.preventDefault();
        setShowShortcuts((s) => !s);
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        e.preventDefault();
        runScan();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        loadSample();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportReport('markdown');
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        exportReport('patch');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, runScan, loadSample, exportReport]);

  const filteredSuggestions = useMemo(() => {
    if (!report) return [];
    if (severityFilter === 'all') return report.suggestions;
    return report.suggestions.filter((s) => s.severity === severityFilter);
  }, [report, severityFilter]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="perf-optimizer-panel"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚡</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              AI 性能优化器
            </h2>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono">
              v1.0.0
            </span>
            <span className="text-xs text-slate-500">规则库: {TOTAL_PERF_RULES} 条</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
            >
              ⌨️
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
              data-testid="close-btn"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-12 gap-4 p-4 overflow-hidden">
          {/* 左栏：预算 + 文件 */}
          <div className="col-span-3 flex flex-col gap-3 overflow-y-auto">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  📊 性能预算
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setShowBudget((b) => !b);
                    persist({ showBudget: !showBudget });
                  }}
                  className="text-xs text-slate-500"
                >
                  {showBudget ? '▼' : '▶'}
                </button>
              </div>
              {showBudget && (
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400">
                      Max Render (ms)
                    </label>
                    <input
                      type="number"
                      value={budget.maxRenderMs}
                      onChange={(e) => updateBudget({ maxRenderMs: Number(e.target.value) })}
                      className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400">
                      Max State/Component
                    </label>
                    <input
                      type="number"
                      value={budget.maxStatePerComponent}
                      onChange={(e) =>
                        updateBudget({ maxStatePerComponent: Number(e.target.value) })
                      }
                      className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400">
                      Min Key Stability (0-1)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={budget.minKeyStability}
                      onChange={(e) =>
                        updateBudget({ minKeyStability: Number(e.target.value) })
                      }
                      className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400">
                      Max Component Lines
                    </label>
                    <input
                      type="number"
                      value={budget.maxComponentLines}
                      onChange={(e) =>
                        updateBudget({ maxComponentLines: Number(e.target.value) })
                      }
                      className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400">
                      Max Unnecessary Memo
                    </label>
                    <input
                      type="number"
                      value={budget.maxUnnecessaryMemo}
                      onChange={(e) =>
                        updateBudget({ maxUnnecessaryMemo: Number(e.target.value) })
                      }
                      className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 dark:text-slate-400">
                      Max Bundle (KB)
                    </label>
                    <input
                      type="number"
                      value={budget.maxBundleSize}
                      onChange={(e) => updateBudget({ maxBundleSize: Number(e.target.value) })}
                      className="w-full px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                📁 文件 ({Object.keys(files).length})
              </h3>
              <div className="space-y-1 mb-2 max-h-40 overflow-y-auto">
                {Object.keys(files).length === 0 && (
                  <div className="text-xs text-slate-400 italic">无文件</div>
                )}
                {Object.keys(files).map((name) => (
                  <div
                    key={name}
                    className="text-xs text-slate-600 dark:text-slate-400 truncate px-2 py-1 bg-white dark:bg-slate-900 rounded"
                    title={name}
                  >
                    📄 {name}
                  </div>
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={loadSample}
                  className="flex-1 px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded text-xs"
                >
                  示例
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded text-xs"
                >
                  上传
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ts,.tsx,.js,.jsx"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={runScan}
              disabled={scanning || Object.keys(files).length === 0}
              data-testid="run-scan-btn"
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded font-semibold"
            >
              {scanning ? '⏳ 扫描中...' : '⚡ 开始扫描'}
            </button>

            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                📊 统计
              </h3>
              <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                <div>Scans: {stats.scans}</div>
                <div>Suggestions: {stats.suggestions}</div>
                <div>Rules: {stats.rules}</div>
              </div>
            </div>
          </div>

          {/* 中栏：评分 + 模式分布 */}
          <div className="col-span-4 flex flex-col gap-3 overflow-y-auto">
            {report ? (
              <>
                <ScoreCard report={report} />
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    📊 By Pattern
                  </h3>
                  <div className="space-y-1">
                    {(Object.keys(report.byPattern) as HookPattern[]).map((p) => {
                      const total = report.byPattern[p] ?? 0;
                      const unnecessary = report.unnecessaryByPattern[p] ?? 0;
                      return (
                        <div key={p} className="text-xs flex items-center gap-2">
                          <span>{PATTERN_ICONS[p]}</span>
                          <span className="font-mono w-24">{PATTERN_LABELS[p]}</span>
                          <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded overflow-hidden">
                            <div
                              className="h-full bg-orange-500"
                              style={{ width: `${total > 0 ? (unnecessary / total) * 100 : 0}%` }}
                            />
                          </div>
                          <span className="font-mono w-16 text-right">
                            {unnecessary}/{total}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {report.budgetViolations.length > 0 && (
                  <div className="bg-red-50 dark:bg-red-900/30 rounded-lg p-3">
                    <h3 className="text-sm font-semibold text-red-700 dark:text-red-300 mb-2">
                      ⚠️ 预算违反 ({report.budgetViolations.length})
                    </h3>
                    <div className="space-y-1 text-xs">
                      {report.budgetViolations.map((v, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between bg-white dark:bg-red-900/20 px-2 py-1 rounded"
                        >
                          <span className="font-mono">{v.metric}</span>
                          <span>
                            实际: <b className="text-red-600">{v.actual}</b> / 预算: {v.budget}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-800 rounded-lg">
                <EmptyState
                  icon="⚡"
                  title="等待扫描"
                  description="添加文件并点击「开始扫描」"
                />
              </div>
            )}
          </div>

          {/* 右栏：建议列表 */}
          <div className="col-span-5 flex flex-col gap-3 overflow-hidden">
            {report && (
              <div className="flex items-center gap-2 text-xs">
                <select
                  value={severityFilter}
                  onChange={(e) =>
                    setSeverityFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')
                  }
                  className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                >
                  <option value="all">全部</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
                <button
                  type="button"
                  onClick={() => exportReport('markdown')}
                  className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded"
                >
                  📋 Markdown
                </button>
                <button
                  type="button"
                  onClick={() => exportReport('patch')}
                  className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded"
                >
                  🩹 Patch
                </button>
                <button
                  type="button"
                  onClick={() => exportReport('json')}
                  className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded"
                >
                  📦 JSON
                </button>
                {copySuccess && (
                  <span className="text-green-600 dark:text-green-400">✓ 已复制</span>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-2">
              {!report && (
                <EmptyState
                  icon="📋"
                  title="无建议"
                  description="扫描后这里会显示重构建议"
                />
              )}
              {report && filteredSuggestions.length === 0 && (
                <div className="text-center text-green-600 dark:text-green-400 p-4 bg-green-50 dark:bg-green-900/20 rounded">
                  ✅ 完美！无重构建议
                </div>
              )}
              {filteredSuggestions.map((s) => (
                <SuggestionCard key={s.id} suggestion={s} />
              ))}
            </div>
          </div>
        </div>

        {/* 错误 */}
        {error && (
          <div className="mx-4 mb-4 p-3 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded text-sm">
            ❌ {error}
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700"
            >
              ✕
            </button>
          </div>
        )}

        {/* 快捷键 */}
        {showShortcuts && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
            onClick={() => setShowShortcuts(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-lg p-4 max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-3">快捷键</h3>
              <ul className="space-y-2 text-sm">
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Esc</kbd> 关闭</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">?</kbd> 快捷键</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+R</kbd> 重新扫描</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+L</kbd> 加载示例</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+E</kbd> 导出 Markdown</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+P</kbd> 导出 Patch</li>
              </ul>
              <button
                type="button"
                onClick={() => setShowShortcuts(false)}
                className="mt-3 px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreCard({ report }: { report: PerfReport }) {
  const grade = scoreGrade(report.score);
  const pct = report.score;
  return (
    <div
      className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 rounded-lg p-4 flex items-center gap-4"
      data-testid="score-card"
    >
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="10" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={grade.color}
            strokeWidth="10"
            strokeDasharray={`${(pct / 100) * 264} 264`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color: grade.color }}>
            {pct}
          </span>
          <span className="text-[10px] text-slate-500">/ 100</span>
        </div>
      </div>
      <div className="flex-1">
        <div className="text-2xl font-bold" style={{ color: grade.color }}>
          {grade.icon} {grade.label}
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          扫描 {report.fileCount} 文件，{report.totalHooks} 个 hook，
          发现 {report.unnecessaryHooks} 个不必要使用
        </div>
        <div className="text-xs text-slate-500 mt-1">
          Bundle 估算: {report.estimatedBundleSize}KB · 耗时: {report.duration}ms
        </div>
      </div>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: RefactorSuggestion }) {
  const [expanded, setExpanded] = useState(false);
  const sevColor =
    suggestion.severity === 'high'
      ? '#dc2626'
      : suggestion.severity === 'medium'
      ? '#ea580c'
      : '#ca8a04';
  const sevIcon =
    suggestion.severity === 'high' ? '🔴' : suggestion.severity === 'medium' ? '🟠' : '🟡';
  return (
    <div
      className="bg-white dark:bg-slate-900 border-l-4 rounded p-2 text-xs shadow-sm"
      style={{ borderLeftColor: sevColor }}
      data-testid="suggestion-card"
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-2">
          <span>{sevIcon}</span>
          <span className="font-mono text-slate-500">
            {suggestion.file}:{suggestion.line}
          </span>
          <span className="font-mono text-blue-600 dark:text-blue-400">
            {suggestion.antiPattern}
          </span>
          <span className="flex-1 truncate text-slate-700 dark:text-slate-300">
            {suggestion.reason}
          </span>
          <span className="text-[10px] text-slate-400">
            -{suggestion.estimatedLOCReduction}行 · {suggestion.estimatedImpact}ms
          </span>
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2">
          <div>
            <div className="text-[10px] font-semibold mb-1 text-red-600">Before:</div>
            <pre className="bg-red-50 dark:bg-red-900/20 p-2 rounded text-[10px] overflow-x-auto">
              {suggestion.originalCode}
            </pre>
          </div>
          <div>
            <div className="text-[10px] font-semibold mb-1 text-green-600">After:</div>
            <pre className="bg-green-50 dark:bg-green-900/20 p-2 rounded text-[10px] overflow-x-auto">
              {suggestion.refactoredCode}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default PerfOptimizerPanel;
