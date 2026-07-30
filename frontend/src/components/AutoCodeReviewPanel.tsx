/**
 * # ============================================================
 * # AutoCodeReviewPanel - 自动化代码评审 UI (v1.0.0 Cycle 25 G25-01)
 * # ============================================================
 * # 核心作用：AutoCodeReviewEngine 的可视化控制面板
 * # 主要功能：
 * #   1. 文件选择（粘贴/上传/示例）
 * #   2. 配置评审选项（启用分类、最大 findings、是否含 patch）
 * #   3. 实时执行 review 并展示结果
 * #   4. 按严重度/分类筛选
 * #   5. 详细 finding 展示（带 before/after 代码 diff）
 * #   6. 报告导出（JSON / Markdown / SARIF）
 * #   7. 规则管理（启用/禁用）
 * #   8. 快捷键支持
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 25 G25-01 初次创建
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getDefaultReviewEngine,
  getRulesByCategoryMap,
  TOTAL_BUILTIN_RULES,
  decideVerdict,
} from '../utils/autoCodeReview';
import {
  CATEGORY_LABELS,
  SEVERITY_COLORS,
  SEVERITY_ICONS,
  SEVERITY_LABELS,
  sortFindingsBySeverity,
  type ReviewCategory,
  type ReviewFinding,
  type ReviewReport,
  type Severity,
} from '../utils/autoCodeReviewTypes';
import { EmptyState } from './EmptyState';

interface AutoCodeReviewPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'hermes.autoCodeReviewPanel';

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
  'src/example.ts': `// 示例代码：包含一些常见问题
import { readFileSync } from 'fs';

export function loadConfig(path: string) {
  // SEC001: eval
  const code = readFileSync(path, 'utf-8');
  eval(code);

  // SEC003: 硬编码密钥
  const apiKey = "sk-1234567890abcdef1234567890abcdef";

  // PERF: 简单过滤
  const items = [1, 2, 3, 4, 5];
  const active = items.filter(i => i > 0);

  return { code, apiKey, active };
}
`,
  'src/utils.ts': `// BUG: 类型断言绕过
export function toNumber(value: any): number {
  return value as number;
}

// STYLE: console.log
export function debug(value: any) {
  console.log('debug:', value);
}
`,
};

export function AutoCodeReviewPanel({ isOpen, onClose }: AutoCodeReviewPanelProps) {
  const engine = useMemo(() => getDefaultReviewEngine(), []);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [enabledCategories, setEnabledCategories] = useState<Set<ReviewCategory>>(
    new Set([
      'bug',
      'security',
      'performance',
      'maintainability',
      'testing',
      'style',
      'accessibility',
      'error-handling',
      'resource-leak',
      'type-safety',
    ])
  );
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'markdown' | 'sarif'>('markdown');
  const [copySuccess, setCopySuccess] = useState(false);
  const [stats, setStats] = useState(engine.getStats());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载持久化设置
  useEffect(() => {
    if (!isOpen) return;
    const stored = safeGetItem(STORAGE_KEY);
    if (Array.isArray(stored.enabledCategories)) {
      setEnabledCategories(new Set(stored.enabledCategories as ReviewCategory[]));
    }
    if (stored.severityFilter) setSeverityFilter(stored.severityFilter as Severity | 'all');
    if (stored.exportFormat) setExportFormat(stored.exportFormat as 'json' | 'markdown' | 'sarif');
  }, [isOpen]);

  // 持久化设置
  const persist = useCallback((patch: Record<string, unknown>) => {
    const cur = safeGetItem(STORAGE_KEY);
    safeSetItem(STORAGE_KEY, { ...cur, ...patch });
  }, []);

  // 事件订阅
  useEffect(() => {
    if (!isOpen) return;
    const onComplete = (r: ReviewReport) => {
      setReport(r);
      setStats(engine.getStats());
    };
    const onError = (err: Error) => {
      setError(err.message);
      setReviewing(false);
    };
    engine.on('complete', onComplete);
    engine.on('error', onError);
    return () => {
      engine.off('complete', onComplete);
      engine.off('error', onError);
    };
  }, [isOpen, engine]);

  // 加载示例文件
  const loadSample = useCallback(() => {
    setFiles(SAMPLE_FILES);
    setError(null);
    setReport(null);
    const firstKey = Object.keys(SAMPLE_FILES)[0];
    if (firstKey) {
      setCurrentFile(firstKey);
      setEditorValue(SAMPLE_FILES[firstKey]);
    }
  }, []);

  // 切换文件
  const handleFileSelect = useCallback(
    (name: string) => {
      setCurrentFile(name);
      setEditorValue(files[name] ?? '');
    },
    [files]
  );

  // 保存当前文件
  const handleSaveCurrent = useCallback(() => {
    if (!currentFile) return;
    setFiles((prev) => ({ ...prev, [currentFile]: editorValue }));
  }, [currentFile, editorValue]);

  // 上传文件
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const newFiles = { ...files, [file.name]: content };
      setFiles(newFiles);
      setCurrentFile(file.name);
      setEditorValue(content);
    };
    reader.readAsText(file);
  }, [files]);

  // 运行 review
  const runReview = useCallback(async () => {
    setError(null);
    setReport(null);
    if (Object.keys(files).length === 0) {
      setError('请先添加文件');
      return;
    }
    setReviewing(true);
    try {
      const r = await engine.review({
        files,
        options: {
          enabledCategories: Array.from(enabledCategories),
          includePatches: true,
        },
      });
      setReport(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  }, [files, engine, enabledCategories]);

  // 切换分类启用状态
  const toggleCategory = useCallback(
    (cat: ReviewCategory) => {
      const newSet = new Set(enabledCategories);
      if (newSet.has(cat)) newSet.delete(cat);
      else newSet.add(cat);
      setEnabledCategories(newSet);
      persist({ enabledCategories: Array.from(newSet) });
    },
    [enabledCategories, persist]
  );

  // 切换规则启用状态
  const toggleRule = useCallback(
    (ruleId: string) => {
      const rule = engine.getRule(ruleId);
      if (!rule) return;
      if (rule.enabled !== false) engine.disableRule(ruleId);
      else engine.enableRule(ruleId);
    },
    [engine]
  );

  // 导出报告
  const exportReport = useCallback(() => {
    if (!report) return;
    let content = '';
    if (exportFormat === 'json') content = engine.exportJSON(report);
    else if (exportFormat === 'markdown') content = engine.exportMarkdown(report);
    else content = engine.exportSARIF(report);
    navigator.clipboard?.writeText(content).then(
      () => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      },
      () => {
        setError('复制失败');
      }
    );
  }, [report, engine, exportFormat]);

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
        runReview();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        exportReport();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        loadSample();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, runReview, exportReport, loadSample]);

  const filteredFindings = useMemo(() => {
    if (!report) return [];
    let findings = sortFindingsBySeverity(report.findings);
    if (severityFilter !== 'all') {
      findings = findings.filter((f) => f.severity === severityFilter);
    }
    return findings;
  }, [report, severityFilter]);

  if (!isOpen) return null;

  const rulesByCategory = getRulesByCategoryMap();
  const verdictLabel = report ? decideVerdict(report.summary) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      data-testid="auto-code-review-panel"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔍</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              自动化代码评审
            </h2>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono">
              v1.0.0
            </span>
            <span className="text-xs text-slate-500">
              规则库: {TOTAL_BUILTIN_RULES} 条
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowShortcuts(true)}
              className="px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
              title="快捷键"
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
          {/* 左栏：文件 + 配置 */}
          <div className="col-span-3 flex flex-col gap-3 overflow-y-auto">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                📁 文件
              </h3>
              <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
                {Object.keys(files).length === 0 && (
                  <div className="text-xs text-slate-400 italic">无文件</div>
                )}
                {Object.keys(files).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handleFileSelect(name)}
                    className={`w-full text-left px-2 py-1 rounded text-xs ${
                      currentFile === name
                        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-200'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    📄 {name}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={loadSample}
                  className="flex-1 px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded text-xs"
                >
                  加载示例
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
                  accept=".ts,.tsx,.js,.jsx,.py,.go,.java,.cs,.cpp,.c,.h"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                🏷️ 启用分类
              </h3>
              <div className="space-y-1">
                {(Object.keys(CATEGORY_LABELS) as ReviewCategory[]).map((cat) => (
                  <label
                    key={cat}
                    className="flex items-center gap-2 text-xs cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={enabledCategories.has(cat)}
                      onChange={() => toggleCategory(cat)}
                    />
                    {CATEGORY_LABELS[cat]}
                  </label>
                ))}
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                📊 统计
              </h3>
              <div className="text-xs space-y-1 text-slate-600 dark:text-slate-400">
                <div>Reviews: {stats.reviews}</div>
                <div>Findings: {stats.findings}</div>
                <div>Rules: {stats.rules}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={runReview}
              disabled={reviewing || Object.keys(files).length === 0}
              data-testid="run-review-btn"
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded font-semibold"
            >
              {reviewing ? '⏳ 评审中...' : '▶️ 开始评审'}
            </button>
          </div>

          {/* 中栏：编辑器 + 结果 */}
          <div className="col-span-5 flex flex-col gap-3 overflow-hidden">
            {currentFile && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 flex-1 flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    ✏️ {currentFile}
                  </h3>
                  <button
                    type="button"
                    onClick={handleSaveCurrent}
                    className="px-2 py-0.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded text-xs"
                  >
                    保存
                  </button>
                </div>
                <textarea
                  value={editorValue}
                  onChange={(e) => setEditorValue(e.target.value)}
                  className="flex-1 w-full font-mono text-xs p-2 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 resize-none"
                  data-testid="code-editor"
                />
              </div>
            )}

            {!currentFile && (
              <div className="flex-1 flex items-center justify-center bg-slate-50 dark:bg-slate-800 rounded-lg">
                <EmptyState
                  icon="📝"
                  title="选择或添加文件"
                  description="点击「加载示例」快速体验，或上传本地代码文件"
                />
              </div>
            )}

            {report && (
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 max-h-60 overflow-y-auto">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    📊 评审摘要
                  </h3>
                  <span
                    className="px-2 py-0.5 rounded text-xs font-semibold"
                    style={{
                      backgroundColor:
                        verdictLabel === 'BLOCK'
                          ? '#fee2e2'
                          : verdictLabel === 'REQUEST_CHANGES'
                          ? '#ffedd5'
                          : '#dcfce7',
                      color:
                        verdictLabel === 'BLOCK'
                          ? '#dc2626'
                          : verdictLabel === 'REQUEST_CHANGES'
                          ? '#ea580c'
                          : '#16a34a',
                    }}
                  >
                    {verdictLabel}
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-1 text-xs">
                  {(['critical', 'high', 'medium', 'low', 'info'] as Severity[]).map((s) => (
                    <div
                      key={s}
                      className="text-center p-1 rounded"
                      style={{ backgroundColor: SEVERITY_COLORS[s] + '20' }}
                    >
                      <div style={{ color: SEVERITY_COLORS[s] }} className="font-bold text-lg">
                        {SEVERITY_ICONS[s]} {report.summary[s]}
                      </div>
                      <div className="text-slate-600 dark:text-slate-400">{SEVERITY_LABELS[s]}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 右栏：Findings 列表 */}
          <div className="col-span-4 flex flex-col gap-3 overflow-hidden">
            {report && (
              <div className="flex items-center gap-2 text-xs">
                <select
                  value={severityFilter}
                  onChange={(e) => {
                    setSeverityFilter(e.target.value as Severity | 'all');
                    persist({ severityFilter: e.target.value });
                  }}
                  className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                >
                  <option value="all">全部严重度</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="info">Info</option>
                </select>
                <select
                  value={exportFormat}
                  onChange={(e) => {
                    setExportFormat(e.target.value as 'json' | 'markdown' | 'sarif');
                    persist({ exportFormat: e.target.value });
                  }}
                  className="px-2 py-1 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-900"
                >
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                  <option value="sarif">SARIF</option>
                </select>
                <button
                  type="button"
                  onClick={exportReport}
                  className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded"
                  data-testid="export-btn"
                >
                  {copySuccess ? '✓ 已复制' : '📋 导出'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRules((s) => !s)}
                  className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 rounded"
                >
                  📋 规则
                </button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-2">
              {filteredFindings.length === 0 && !report && (
                <EmptyState
                  icon="🚀"
                  title="等待评审"
                  description="点击「开始评审」按钮执行自动化代码评审"
                />
              )}
              {filteredFindings.length === 0 && report && (
                <div className="text-center text-green-600 dark:text-green-400 p-4 bg-green-50 dark:bg-green-900/20 rounded">
                  ✅ 干净！无问题
                </div>
              )}
              {filteredFindings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </div>
          </div>
        </div>

        {/* 错误提示 */}
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

        {/* 规则管理弹窗 */}
        {showRules && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-black/40"
            onClick={() => setShowRules(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-lg p-4 max-w-2xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-3">规则管理</h3>
              {(Object.keys(rulesByCategory) as ReviewCategory[]).map((cat) => (
                <div key={cat} className="mb-3">
                  <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300 mb-1">
                    {CATEGORY_LABELS[cat]}
                  </h4>
                  <div className="space-y-1">
                    {rulesByCategory[cat].map((r) => (
                      <label
                        key={r.id}
                        className="flex items-center gap-2 text-xs cursor-pointer p-1 hover:bg-slate-50 dark:hover:bg-slate-800 rounded"
                      >
                        <input
                          type="checkbox"
                          checked={r.enabled !== false}
                          onChange={() => toggleRule(r.id)}
                        />
                        <span className="font-mono text-blue-600 dark:text-blue-400">
                          {r.id}
                        </span>
                        <span className="text-slate-500">
                          ({SEVERITY_ICONS[r.severity]})
                        </span>
                        <span>{r.description}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setShowRules(false)}
                className="mt-3 px-3 py-1 bg-slate-200 dark:bg-slate-700 rounded"
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {/* 快捷键帮助 */}
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
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Esc</kbd> 关闭面板</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">?</kbd> 显示快捷键</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+R</kbd> 重新评审</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+E</kbd> 导出报告</li>
                <li><kbd className="px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+L</kbd> 加载示例</li>
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

function FindingCard({ finding }: { finding: ReviewFinding }) {
  const [expanded, setExpanded] = useState(false);
  const icon = SEVERITY_ICONS[finding.severity];
  const color = SEVERITY_COLORS[finding.severity];
  return (
    <div
      className="bg-white dark:bg-slate-900 border-l-4 rounded p-2 text-xs shadow-sm"
      style={{ borderLeftColor: color }}
      data-testid="finding-card"
    >
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full text-left"
      >
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <span className="font-mono text-slate-500">
            {finding.file}
            {finding.line ? `:${finding.line}` : ''}
          </span>
          <span className="font-semibold flex-1 text-slate-900 dark:text-slate-100">
            {finding.title}
          </span>
          {finding.ruleId && (
            <span className="text-slate-400 font-mono text-[10px]">{finding.ruleId}</span>
          )}
        </div>
      </button>
      {expanded && (
        <div className="mt-2 space-y-2 text-slate-600 dark:text-slate-400">
          <p>{finding.message}</p>
          {finding.existingCode && (
            <div>
              <div className="font-semibold mb-1">Current:</div>
              <pre className="bg-red-50 dark:bg-red-900/20 p-2 rounded text-[10px] overflow-x-auto">
                {finding.existingCode}
              </pre>
            </div>
          )}
          {finding.suggestedPatch && (
            <div>
              <div className="font-semibold mb-1">Suggested:</div>
              <pre className="bg-green-50 dark:bg-green-900/20 p-2 rounded text-[10px] overflow-x-auto">
                {finding.suggestedPatch}
              </pre>
            </div>
          )}
          {finding.why && (
            <p className="italic text-slate-500">Why: {finding.why}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default AutoCodeReviewPanel;
