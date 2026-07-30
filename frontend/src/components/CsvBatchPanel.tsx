/**
 * # ============================================================
 * # CSV Batch Panel - CSV 批处理智能体 UI 组件 (v1.0.0 Cycle 26 G26-01)
 * # ============================================================
 * # 核心作用：提供 CSV 驱动的批量智能体任务扇出的用户界面
 * # 主要功能：
 * #   1. CSV 文件上传与解析预览
 * #   2. 指令模板输入与占位符
 * #   3. 并发/超时/重试配置
 * #   4. 实时进度监控 + ETA
 * #   5. 结果导出（CSV / JSON）
 * #   6. 快捷键：Esc / Ctrl+Enter / Ctrl+R / Ctrl+E / Ctrl+L
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-01 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  getDefaultCsvBatchEngine,
  parseCsvContent,
  parseTemplate,
} from '../utils/csvBatchEngine';
import {
  CsvBatchJob,
  CsvBatchItem,
  CsvBatchProgress,
  ItemStatus,
  JOB_STATUS_LABELS,
  JOB_STATUS_ICONS,
  ITEM_STATUS_LABELS,
  ITEM_STATUS_ICONS,
} from '../utils/csvBatchEngineTypes';
import { EmptyState } from './EmptyState';

interface CsvBatchPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'hermes.csvBatchPanel';

const SAMPLE_CSV = `id,title,content
1,AI News,"The latest breakthrough in AI"
2,Tech Update,"New JavaScript framework released"
3,Science,"Quantum computing milestone achieved"
4,Health,"New study on sleep quality"
5,Business,"Stock market reaches new high"`;

const SAMPLE_INSTRUCTION = `Please summarize the following article in one sentence: {content}

Title: {title}
ID: {id|upper}`;

export function CsvBatchPanel({ isOpen, onClose }: CsvBatchPanelProps) {
  // 引擎实例
  const engine = useMemo(() => getDefaultCsvBatchEngine(), []);
  const [_, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  // 状态
  const [, setCsvContent] = useState<string>('');
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [idColumn, setIdColumn] = useState<string>('');
  const [outputField, setOutputField] = useState<string>('result');
  const [instruction, setInstruction] = useState<string>(SAMPLE_INSTRUCTION);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(3);
  const [maxRetries, setMaxRetries] = useState<number>(2);
  const [failureStrategy, setFailureStrategy] = useState<'fail-fast' | 'continue'>('continue');
  const [currentJob, setCurrentJob] = useState<CsvBatchJob | null>(null);
  const [progress, setProgress] = useState<CsvBatchProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 从 localStorage 恢复
  useEffect(() => {
    if (!isOpen) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.instruction) setInstruction(cfg.instruction);
        if (cfg.maxConcurrency) setMaxConcurrency(cfg.maxConcurrency);
        if (cfg.maxRetries !== undefined) setMaxRetries(cfg.maxRetries);
        if (cfg.failureStrategy) setFailureStrategy(cfg.failureStrategy);
        if (cfg.outputField) setOutputField(cfg.outputField);
      }
    } catch {
      // ignore
    }
  }, [isOpen]);

  // 持久化配置
  useEffect(() => {
    if (!isOpen) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ instruction, maxConcurrency, maxRetries, failureStrategy, outputField })
    );
  }, [isOpen, instruction, maxConcurrency, maxRetries, failureStrategy, outputField]);

  // 事件订阅
  useEffect(() => {
    if (!isOpen) return;
    const offs: Array<() => void> = [];
    offs.push(engine.on('job-created', refresh));
    offs.push(engine.on('job-started', refresh));
    offs.push(engine.on('job-completed', refresh));
    offs.push(engine.on('job-failed', refresh));
    offs.push(engine.on('job-cancelled', refresh));
    offs.push(engine.on('item-started', refresh));
    offs.push(engine.on('item-completed', refresh));
    offs.push(engine.on('item-failed', refresh));
    offs.push(
      engine.on('progress', (e) => {
        if (e.type === 'progress') {
          setProgress(e.progress);
        }
      })
    );
    return () => offs.forEach((off) => off());
  }, [isOpen, engine, refresh]);

  // 更新当前 job
  useEffect(() => {
    if (currentJob) {
      const updated = engine.getJob(currentJob.id);
      if (updated) {
        setCurrentJob(updated);
        setProgress(engine.getProgress(currentJob.id) ?? null);
      }
    }
  }, [currentJob, engine, _]);

  // 快捷键
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (currentJob && (currentJob.status === 'paused' || currentJob.status === 'failed')) {
          handleRetry();
        } else if (rows.length > 0) {
          handleStart();
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (currentJob) handleRetry();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (currentJob) handleExport();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        handleLoadSample();
      } else if (e.key === '?') {
        e.preventDefault();
        setShowHelp((s) => !s);
      }
    };
    document.body.addEventListener('keydown', handler);
    return () => document.body.removeEventListener('keydown', handler);
  }, [isOpen, currentJob, rows]);

  if (!isOpen) return null;

  // ============ 操作 ============

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      handleParseCsv(file.name, content);
    };
    reader.readAsText(file);
  };

  const handleParseCsv = (name: string, content: string) => {
    try {
      const result = parseCsvContent(content);
      void name; // 未来可用于来源标识
      setCsvContent(content);
      setColumns(result.columns);
      setRows(result.rows);
      // 自动选择 id 列
      const idCol = result.columns.find((c) => c.toLowerCase() === 'id') || result.columns[0] || '';
      setIdColumn(idCol);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleLoadSample = () => {
    handleParseCsv('sample.csv', SAMPLE_CSV);
  };

  const handleStart = async () => {
    if (rows.length === 0) return;
    setError(null);
    setRunning(true);
    try {
      const job = engine.createJob({
        name: `Job ${new Date().toLocaleTimeString()}`,
        inputFile: 'manual.csv',
        columns,
        instruction,
        rows,
        idColumn: idColumn || undefined,
        outputField,
        config: {
          maxConcurrency,
          maxRetries,
          failureStrategy,
          autoRetry: maxRetries > 0,
          maxRuntimeSeconds: 60,
          persist: true,
        },
      });
      setCurrentJob(job);
      // 模拟执行器
      const executor = async (instr: string) => {
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
        return `[Mock] Processed: ${instr.slice(0, 50)}...`;
      };
      await engine.startJob(job.id, executor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handlePause = () => {
    if (currentJob) engine.pauseJob(currentJob.id);
  };

  const handleCancel = () => {
    if (currentJob) engine.cancelJob(currentJob.id);
  };

  const handleRetry = async () => {
    if (!currentJob) return;
    setRunning(true);
    try {
      const executor = async (instr: string) => {
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
        return `[Mock Retry] ${instr.slice(0, 50)}...`;
      };
      await engine.retryFailed(currentJob.id, executor);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const handleExport = () => {
    if (!currentJob) return;
    try {
      const csv = engine.exportResults(currentJob.id);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentJob.name.replace(/\s+/g, '_')}_results.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleReset = () => {
    setCsvContent('');
    setColumns([]);
    setRows([]);
    setCurrentJob(null);
    setProgress(null);
    setError(null);
  };

  // ============ 渲染 ============

  const placeholders = instruction ? parseTemplate(instruction) : [];

  return (
    <div
      data-testid="csv-batch-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📊</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">CSV 批处理智能体</h2>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono">v1.0.0</span>
          </div>
          <button
            data-testid="close-btn"
            onClick={onClose}
            className="px-3 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            ✕
          </button>
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* 左列：配置 */}
          <div className="space-y-4">
            {/* 步骤 1：上传 CSV */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">📁 步骤 1：上传 CSV</h3>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={handleLoadSample}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                  data-testid="load-sample-btn"
                >
                  📥 加载示例
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300"
                >
                  📂 浏览文件
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </div>
              {columns.length > 0 ? (
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <div>列: {columns.join(', ')}</div>
                  <div>行数: {rows.length}</div>
                </div>
              ) : (
                <div className="text-xs text-slate-400">未加载文件</div>
              )}
            </div>

            {/* 步骤 2：配置 */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">⚙️ 步骤 2：配置</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-sm w-20">ID 列:</label>
                  <select
                    value={idColumn}
                    onChange={(e) => setIdColumn(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    data-testid="id-column-select"
                  >
                    <option value="">(自动)</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm w-20">输出字段:</label>
                  <input
                    value={outputField}
                    onChange={(e) => setOutputField(e.target.value)}
                    className="flex-1 px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    data-testid="output-field-input"
                  />
                </div>
                <div>
                  <label className="text-sm block mb-1">指令模板:</label>
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    rows={4}
                    className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800 font-mono"
                    data-testid="instruction-input"
                  />
                  {placeholders.length > 0 && (
                    <div className="text-xs text-slate-500 mt-1">
                      占位符: {placeholders.map((p) => `{${p.column}${p.transform !== 'plain' ? `|${p.transform}` : ''}}`).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 步骤 3：执行选项 */}
            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">🚀 步骤 3：执行选项</h3>
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <label className="block text-xs text-slate-500">并发</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={maxConcurrency}
                    onChange={(e) => setMaxConcurrency(parseInt(e.target.value, 10))}
                    className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    data-testid="concurrency-input"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">重试次数</label>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    value={maxRetries}
                    onChange={(e) => setMaxRetries(parseInt(e.target.value, 10))}
                    className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500">失败策略</label>
                  <select
                    value={failureStrategy}
                    onChange={(e) => setFailureStrategy(e.target.value as any)}
                    className="w-full px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                  >
                    <option value="continue">继续</option>
                    <option value="fail-fast">快速失败</option>
                  </select>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleStart}
                  disabled={rows.length === 0 || running}
                  className="px-3 py-1 text-sm bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-slate-300"
                  data-testid="start-btn"
                >
                  ▶ 开始执行
                </button>
                <button
                  onClick={handleReset}
                  className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 rounded hover:bg-slate-300"
                >
                  🔄 重置
                </button>
              </div>
            </div>
          </div>

          {/* 右列：进度 + 结果 */}
          <div className="space-y-4">
            {/* 进度 */}
            {progress && currentJob && (
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  📈 Job: {currentJob.name} ({JOB_STATUS_ICONS[currentJob.status]} {JOB_STATUS_LABELS[currentJob.status]})
                </h3>
                <div className="space-y-2">
                  <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${progress.rate * 100}%` }}
                      data-testid="progress-bar"
                    />
                  </div>
                  <div className="text-xs flex justify-between text-slate-600 dark:text-slate-400">
                    <span>✅ {progress.completed} | ❌ {progress.failed} | ⏳ {progress.pending} | ⚙️ {progress.running}</span>
                    <span>ETA: {progress.etaSeconds}s</span>
                  </div>
                </div>
                <div className="mt-3 max-h-48 overflow-auto space-y-1">
                  {currentJob.items.map((item) => (
                    <ItemRow key={item.id} item={item} />
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  {currentJob.status === 'running' && (
                    <button onClick={handlePause} className="px-2 py-1 text-xs bg-amber-500 text-white rounded">⏸ 暂停</button>
                  )}
                  {(currentJob.status === 'running' || currentJob.status === 'paused') && (
                    <button onClick={handleCancel} className="px-2 py-1 text-xs bg-red-500 text-white rounded">⏹ 停止</button>
                  )}
                  {currentJob.status === 'failed' && (
                    <button onClick={handleRetry} className="px-2 py-1 text-xs bg-blue-500 text-white rounded" data-testid="retry-btn">🔄 重试</button>
                  )}
                  {(currentJob.status === 'completed' || currentJob.status === 'failed' || currentJob.status === 'cancelled') && (
                    <button onClick={handleExport} className="px-2 py-1 text-xs bg-green-500 text-white rounded" data-testid="export-btn">📥 导出 CSV</button>
                  )}
                </div>
              </div>
            )}

            {/* 错误 */}
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg p-3 text-sm text-red-700 dark:text-red-300" data-testid="error-banner">
                ⚠️ {error}
              </div>
            )}

            {/* 空状态 */}
            {!currentJob && rows.length === 0 && (
              <EmptyState
                icon="📊"
                title="加载 CSV 文件"
                description="点击「加载示例」或上传你的 CSV 文件开始批处理"
              />
            )}

            {/* 历史 Job 列表 */}
            {engine.getAllJobs().length > 1 && (
              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
                <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">📋 历史 Job</h3>
                <div className="space-y-1 max-h-32 overflow-auto">
                  {engine.getAllJobs().slice(0, 5).map((job) => (
                    <button
                      key={job.id}
                      onClick={() => setCurrentJob(job)}
                      className="w-full text-left text-xs p-2 bg-white dark:bg-slate-800 rounded hover:bg-blue-50 dark:hover:bg-slate-700 flex items-center justify-between"
                    >
                      <span>{job.name}</span>
                      <span>{JOB_STATUS_ICONS[job.status]} {JOB_STATUS_LABELS[job.status]}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 底部状态栏 */}
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-xs text-slate-500 flex justify-between">
          <span>📊 Jobs: {engine.getStats().jobs} | Items: {engine.getStats().items}</span>
          <span>Ctrl+Enter 开始 | Ctrl+E 导出 | ? 帮助</span>
        </div>

        {/* 帮助弹窗 */}
        {showHelp && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10" onClick={() => setShowHelp(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-lg p-6 max-w-md" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-3">⌨️ 快捷键</h3>
              <ul className="space-y-1 text-sm">
                <li><kbd className="px-1 bg-slate-100 dark:bg-slate-800 rounded">Esc</kbd> 关闭面板</li>
                <li><kbd className="px-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+Enter</kbd> 开始执行</li>
                <li><kbd className="px-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+L</kbd> 加载示例</li>
                <li><kbd className="px-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+R</kbd> 重试失败</li>
                <li><kbd className="px-1 bg-slate-100 dark:bg-slate-800 rounded">Ctrl+E</kbd> 导出 CSV</li>
                <li><kbd className="px-1 bg-slate-100 dark:bg-slate-800 rounded">?</kbd> 显示/隐藏帮助</li>
              </ul>
              <h3 className="text-lg font-bold mt-4 mb-2">📝 模板语法</h3>
              <ul className="text-xs space-y-1">
                <li><code>{'{column}'}</code> - 简单替换</li>
                <li><code>{'{column|upper}'}</code> - 大写</li>
                <li><code>{'{column|lower}'}</code> - 小写</li>
                <li><code>{'{column|trim}'}</code> - 去空格</li>
                <li><code>{'{column|default:FALLBACK}'}</code> - 缺省值</li>
                <li><code>{'{column|json}'}</code> - JSON 编码</li>
                <li><code>{'{column|slice:0:10}'}</code> - 切片</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: CsvBatchItem }) {
  return (
    <div
      data-testid={`item-${item.status}`}
      className="flex items-center justify-between text-xs p-1 bg-white dark:bg-slate-800 rounded"
    >
      <span className="truncate flex-1">{item.id}</span>
      <span className="ml-2 flex items-center gap-1">
        {ITEM_STATUS_ICONS[item.status as ItemStatus]} {ITEM_STATUS_LABELS[item.status as ItemStatus]}
        {item.retries > 0 && <span className="text-amber-500">(重试 {item.retries})</span>}
      </span>
    </div>
  );
}
