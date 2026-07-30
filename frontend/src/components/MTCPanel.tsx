/**
 * # ============================================================
 * # MTC Panel - 多模任务协作 UI 组件 (v1.0.0 Cycle 26 G26-03)
 * # ============================================================
 * # 核心作用：提供 More Than Coding 多模任务协作的图形化界面
 * # 主要功能：
 * #   1. 文件上传与类型检测（10 种文件类型）
 * #   2. 7 种任务类型选择（总结/翻译/重写/分析/转换/提取/优化）
 * #   3. 任务参数配置与执行
 * #   4. 结果展示（Markdown/JSON/CSV/YAML/HTML/Text）
 * #   5. 任务历史记录与导出
 * #   6. 快捷键：Esc / Ctrl+N / Ctrl+R / Ctrl+E
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 26 G26-03 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  getDefaultMtcAdapter,
} from '../utils/mtcAdapter';
import {
  MtcTaskType,
  MtcOutputFormat,
  MtcTaskParams,
  FILE_TYPE_LABELS,
  FILE_TYPE_ICONS,
  TASK_TYPE_LABELS,
  TASK_TYPE_ICONS,
  TASK_TYPE_DESCRIPTIONS,
  OUTPUT_FORMAT_LABELS,
} from '../utils/mtcAdapterTypes';

interface MTCPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STORAGE_KEY = 'hermes.mtcPanel';

const SAMPLE_FILES = [
  { name: 'article.md', content: '# AI 革命\n\n人工智能正在改变世界。机器学习、深度学习、自然语言处理等技术快速发展，推动了各行各业的变革。从医疗诊断到自动驾驶，从智能客服到创意生成，AI 的应用场景越来越广泛。\n\n未来，随着大模型技术的成熟，AI 将在更多领域发挥关键作用。' },
  { name: 'data.json', content: '{\n  "users": [\n    {"name": "Alice", "age": 30, "city": "Beijing"},\n    {"name": "Bob", "age": 25, "city": "Shanghai"},\n    {"name": "Charlie", "age": 35, "city": "Guangzhou"}\n  ],\n  "total": 3\n}' },
  { name: 'sample.csv', content: 'name,score,category\nAlice,95,A\nBob,87,B\nCharlie,92,A\nDavid,78,C' },
];

export function MTCPanel({ isOpen, onClose }: MTCPanelProps) {
  const adapter = useMemo(() => getDefaultMtcAdapter(), []);
  const [, forceUpdate] = useState(0);
  const refresh = useCallback(() => forceUpdate((n) => n + 1), []);

  // 状态
  const [tab, setTab] = useState<'files' | 'tasks' | 'history'>('tasks');
  const [taskType, setTaskType] = useState<MtcTaskType>('summarize');
  const [outputFormat, setOutputFormat] = useState<MtcOutputFormat>('markdown');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // 任务参数
  const [maxLength, setMaxLength] = useState<number>(200);
  const [language, setLanguage] = useState<string>('中文');
  const [translateFrom, setTranslateFrom] = useState<string>('中文');
  const [translateTo, setTranslateTo] = useState<string>('English');
  const [rewriteStyle, setRewriteStyle] = useState<'formal' | 'casual' | 'academic' | 'creative' | 'concise'>('formal');
  const [targetFormat, setTargetFormat] = useState<'json' | 'yaml' | 'toml' | 'csv' | 'markdown' | 'html'>('yaml');
  const [extractFields, setExtractFields] = useState<string>('name,age');
  const [optimizeGoals, setOptimizeGoals] = useState<string>('性能,可读性');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 订阅事件
  useEffect(() => {
    if (!isOpen) return;
    const offs: Array<() => void> = [];
    offs.push(adapter.on('file-loaded', refresh));
    offs.push(adapter.on('file-removed', refresh));
    offs.push(adapter.on('task-created', refresh));
    offs.push(adapter.on('task-started', refresh));
    offs.push(adapter.on('task-completed', refresh));
    offs.push(adapter.on('task-failed', refresh));
    offs.push(adapter.on('task-cancelled', refresh));
    return () => offs.forEach((off) => off());
  }, [isOpen, adapter, refresh]);

  // 恢复配置
  useEffect(() => {
    if (!isOpen) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg.tab) setTab(cfg.tab);
        if (cfg.taskType) setTaskType(cfg.taskType);
        if (cfg.outputFormat) setOutputFormat(cfg.outputFormat);
      }
    } catch {
      // ignore
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tab, taskType, outputFormat }));
  }, [isOpen, tab, taskType, outputFormat]);

  // 快捷键
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleCreateSampleFiles();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        handleRunTask();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        handleExportResult();
      } else if (e.key === '?') {
        e.preventDefault();
        setShowHelp((s) => !s);
      } else if (e.ctrlKey && e.key === '1') {
        e.preventDefault();
        setTab('files');
      } else if (e.ctrlKey && e.key === '2') {
        e.preventDefault();
        setTab('tasks');
      } else if (e.ctrlKey && e.key === '3') {
        e.preventDefault();
        setTab('history');
      }
    };
    document.body.addEventListener('keydown', handler);
    return () => document.body.removeEventListener('keydown', handler);
  }, [isOpen, selectedFileIds, taskType, currentTaskId]);

  if (!isOpen) return null;

  // ============ 文件操作 ============

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      try {
        adapter.loadFileFromContent(file.name, content);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCreateSampleFiles = () => {
    SAMPLE_FILES.forEach((sf) => {
      try {
        adapter.loadFileFromContent(sf.name, sf.content);
      } catch {
        // ignore
      }
    });
  };

  const handleRemoveFile = (fileId: string) => {
    adapter.removeFile(fileId);
    setSelectedFileIds((prev) => prev.filter((id) => id !== fileId));
  };

  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  // ============ 任务操作 ============

  const buildTaskParams = (): MtcTaskParams => {
    switch (taskType) {
      case 'summarize':
        return { type: 'summarize', maxLength, language };
      case 'translate':
        return { type: 'translate', from: translateFrom, to: translateTo };
      case 'rewrite':
        return { type: 'rewrite', style: rewriteStyle };
      case 'analyze':
        return { type: 'analyze', generateVisualization: true };
      case 'convert':
        return { type: 'convert', targetFormat };
      case 'extract':
        return { type: 'extract', fields: extractFields.split(',').map((s) => s.trim()).filter(Boolean), format: 'json' };
      case 'optimize':
        return { type: 'optimize', goals: optimizeGoals.split(',').map((s) => s.trim()).filter(Boolean) };
    }
  };

  const handleRunTask = async () => {
    if (selectedFileIds.length === 0) {
      setError('请先选择文件');
      return;
    }
    setError(null);
    setRunning(true);
    setCurrentResult('');
    try {
      const task = adapter.createTask({
        type: taskType,
        fileIds: selectedFileIds,
        params: buildTaskParams(),
        outputFormat,
      });
      setCurrentTaskId(task.id);
      const result = await adapter.runTask(task.id);
      setCurrentResult(result.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleExportResult = () => {
    if (!currentResult || !currentTaskId) return;
    try {
      const exported = adapter.exportResult(currentTaskId, outputFormat);
      const blob = new Blob([exported], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mtc-result-${currentTaskId}.${outputFormat === 'markdown' ? 'md' : outputFormat}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLoadHistoryTask = (taskId: string) => {
    const task = adapter.getTask(taskId);
    if (!task) return;
    setCurrentTaskId(taskId);
    setCurrentResult(task.result?.content || '');
    setTaskType(task.type);
    setOutputFormat(task.outputFormat);
    setSelectedFileIds(task.fileIds);
  };

  // ============ 渲染 ============

  const allFiles = adapter.getAllFiles();
  const allTasks = adapter.getAllTasks();
  const stats = adapter.getStats();

  return (
    <div
      data-testid="mtc-panel"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        data-testid="mtc-content"
        className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-7xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎨</span>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
              MTC 多模任务协作
            </h2>
            <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-mono">
              v1.0.0
            </span>
            <span className="text-xs text-slate-500">
              文件 {stats.files} | 任务 {stats.tasks}
            </span>
          </div>
          <button
            data-testid="close-btn"
            onClick={onClose}
            className="px-3 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-lg"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-700">
          <button
            data-testid="tab-tasks"
            onClick={() => setTab('tasks')}
            className={`px-4 py-2 text-sm font-medium ${
              tab === 'tasks'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            🎯 任务执行
          </button>
          <button
            data-testid="tab-files"
            onClick={() => setTab('files')}
            className={`px-4 py-2 text-sm font-medium ${
              tab === 'files'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            📁 文件管理 ({allFiles.length})
          </button>
          <button
            data-testid="tab-history"
            onClick={() => setTab('history')}
            className={`px-4 py-2 text-sm font-medium ${
              tab === 'history'
                ? 'border-b-2 border-blue-500 text-blue-600 dark:text-blue-400'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            📜 历史 ({allTasks.length})
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-4">
          {tab === 'files' && (
            <div className="space-y-4">
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
                  data-testid="upload-file-btn"
                >
                  📂 上传文件
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.css,.html,.yaml,.yml,.xml"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <button
                  onClick={handleCreateSampleFiles}
                  className="px-3 py-1 text-sm bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded hover:bg-slate-300"
                  data-testid="load-samples-btn"
                >
                  📥 加载示例文件
                </button>
              </div>
              <div className="space-y-2">
                {allFiles.length === 0 ? (
                  <div className="text-center py-8 text-slate-400">无文件</div>
                ) : (
                  allFiles.map((file) => {
                    const selected = selectedFileIds.includes(file.id);
                    return (
                      <div
                        key={file.id}
                        data-testid="file-card"
                        className={`bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border cursor-pointer ${
                          selected
                            ? 'border-blue-500 ring-1 ring-blue-500/50'
                            : 'border-slate-200 dark:border-slate-700'
                        }`}
                        onClick={() => toggleFileSelection(file.id)}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-2 flex-1">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleFileSelection(file.id)}
                              className="mt-1"
                              data-testid="file-checkbox"
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{FILE_TYPE_ICONS[file.type]}</span>
                                <span className="font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
                                  {file.name}
                                </span>
                                <span className="text-xs px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 rounded">
                                  {FILE_TYPE_LABELS[file.type]}
                                </span>
                                <span className="text-xs text-slate-400">
                                  {file.size} 字符
                                </span>
                              </div>
                              <pre className="text-xs text-slate-500 dark:text-slate-400 mt-1 overflow-hidden max-h-16 whitespace-pre-wrap">
                                {file.content.slice(0, 200)}
                                {file.content.length > 200 && '...'}
                              </pre>
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveFile(file.id);
                            }}
                            className="ml-2 px-2 py-0.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded hover:bg-red-200"
                            data-testid="file-remove"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {tab === 'tasks' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* 左列：任务配置 */}
              <div className="space-y-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    1️⃣ 选择任务类型
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(TASK_TYPE_LABELS) as MtcTaskType[]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTaskType(t)}
                        data-testid={`task-type-${t}`}
                        className={`px-3 py-2 text-sm rounded border text-left ${
                          taskType === t
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                        }`}
                      >
                        <div className="font-medium">
                          {TASK_TYPE_ICONS[t]} {TASK_TYPE_LABELS[t]}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          {TASK_TYPE_DESCRIPTIONS[t]}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    2️⃣ 配置参数
                  </h3>
                  {taskType === 'summarize' && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-slate-600 dark:text-slate-400">语言</label>
                        <input
                          type="text"
                          value={language}
                          onChange={(e) => setLanguage(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-600 dark:text-slate-400">最大长度 (字)</label>
                        <input
                          type="number"
                          value={maxLength}
                          onChange={(e) => setMaxLength(parseInt(e.target.value, 10) || 200)}
                          className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                        />
                      </div>
                    </div>
                  )}
                  {taskType === 'translate' && (
                    <div className="space-y-2">
                      <div>
                        <label className="text-xs text-slate-600 dark:text-slate-400">源语言</label>
                        <input
                          type="text"
                          value={translateFrom}
                          onChange={(e) => setTranslateFrom(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-600 dark:text-slate-400">目标语言</label>
                        <input
                          type="text"
                          value={translateTo}
                          onChange={(e) => setTranslateTo(e.target.value)}
                          className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                        />
                      </div>
                    </div>
                  )}
                  {taskType === 'rewrite' && (
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">风格</label>
                      <select
                        value={rewriteStyle}
                        onChange={(e) => setRewriteStyle(e.target.value as any)}
                        className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                      >
                        <option value="formal">正式</option>
                        <option value="casual">随意</option>
                        <option value="academic">学术</option>
                        <option value="creative">创意</option>
                        <option value="concise">简洁</option>
                      </select>
                    </div>
                  )}
                  {taskType === 'convert' && (
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">目标格式</label>
                      <select
                        value={targetFormat}
                        onChange={(e) => setTargetFormat(e.target.value as any)}
                        className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                      >
                        <option value="json">JSON</option>
                        <option value="yaml">YAML</option>
                        <option value="toml">TOML</option>
                        <option value="csv">CSV</option>
                        <option value="markdown">Markdown</option>
                        <option value="html">HTML</option>
                      </select>
                    </div>
                  )}
                  {taskType === 'extract' && (
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">提取字段 (逗号分隔)</label>
                      <input
                        type="text"
                        value={extractFields}
                        onChange={(e) => setExtractFields(e.target.value)}
                        className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                        data-testid="extract-fields"
                      />
                    </div>
                  )}
                  {taskType === 'optimize' && (
                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">优化目标 (逗号分隔)</label>
                      <input
                        type="text"
                        value={optimizeGoals}
                        onChange={(e) => setOptimizeGoals(e.target.value)}
                        className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                      />
                    </div>
                  )}
                  {taskType === 'analyze' && (
                    <div className="text-xs text-slate-500">将自动生成可视化建议</div>
                  )}
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
                  <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    3️⃣ 选择文件 ({selectedFileIds.length}) + 输出格式
                  </h3>
                  <div className="text-xs text-slate-500 mb-2">
                    {selectedFileIds.length === 0 ? '请在「文件管理」中选择文件' : `已选 ${selectedFileIds.length} 个文件`}
                  </div>
                  <select
                    value={outputFormat}
                    onChange={(e) => setOutputFormat(e.target.value as MtcOutputFormat)}
                    className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800"
                    data-testid="output-format"
                  >
                    {(Object.keys(OUTPUT_FORMAT_LABELS) as MtcOutputFormat[]).map((f) => (
                      <option key={f} value={f}>{OUTPUT_FORMAT_LABELS[f]}</option>
                    ))}
                  </select>
                  <button
                    onClick={handleRunTask}
                    disabled={running || selectedFileIds.length === 0}
                    className="w-full mt-3 px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-slate-300 disabled:cursor-not-allowed"
                    data-testid="run-task-btn"
                  >
                    {running ? '⏳ 执行中...' : `▶️ 执行 ${TASK_TYPE_LABELS[taskType]} 任务`}
                  </button>
                  {error && (
                    <div className="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="error-msg">
                      ❌ {error}
                    </div>
                  )}
                </div>
              </div>

              {/* 右列：结果展示 */}
              <div className="space-y-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-semibold text-slate-700 dark:text-slate-300">
                      📄 执行结果
                    </h3>
                    {currentResult && (
                      <button
                        onClick={handleExportResult}
                        className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                        data-testid="export-result-btn"
                      >
                        📥 导出
                      </button>
                    )}
                  </div>
                  {running ? (
                    <div className="text-center py-8 text-slate-400" data-testid="running-indicator">
                      <div className="text-2xl mb-2">⏳</div>
                      <div>任务执行中...</div>
                    </div>
                  ) : currentResult ? (
                    <pre
                      className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-3 rounded border border-slate-200 dark:border-slate-700 overflow-auto max-h-96 whitespace-pre-wrap"
                      data-testid="result-content"
                    >
                      {currentResult}
                    </pre>
                  ) : (
                    <div className="text-center py-8 text-slate-400">
                      暂无结果
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'history' && (
            <div className="space-y-2">
              {allTasks.length === 0 ? (
                <div className="text-center py-8 text-slate-400">暂无历史任务</div>
              ) : (
                allTasks.map((task) => (
                  <div
                    key={task.id}
                    data-testid="history-task"
                    className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3 border border-slate-200 dark:border-slate-700 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800"
                    onClick={() => handleLoadHistoryTask(task.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span>{TASK_TYPE_ICONS[task.type]}</span>
                      <span className="font-medium">{TASK_TYPE_LABELS[task.type]}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          task.status === 'completed'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : task.status === 'failed'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                            : task.status === 'running'
                            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {task.status}
                      </span>
                      <span className="text-xs text-slate-400 ml-auto">
                        {new Date(task.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      文件: {task.fileIds.length} | 输出: {OUTPUT_FORMAT_LABELS[task.outputFormat]}
                    </div>
                    {task.error && (
                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                        错误: {task.error}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Help Modal */}
        {showHelp && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
            onClick={() => setShowHelp(false)}
          >
            <div
              className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl p-6 max-w-lg w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold mb-2">⌨️ 快捷键</h3>
              <ul className="text-sm space-y-1 text-slate-700 dark:text-slate-300">
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Esc</kbd> - 关闭</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Ctrl+N</kbd> - 加载示例文件</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Ctrl+R</kbd> - 执行任务</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Ctrl+E</kbd> - 导出结果</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">Ctrl+1/2/3</kbd> - 切换 Tab</li>
                <li><kbd className="px-1 bg-slate-200 dark:bg-slate-700 rounded">?</kbd> - 显示/隐藏帮助</li>
              </ul>
              <button
                onClick={() => setShowHelp(false)}
                className="mt-4 px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                关闭
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-700 px-4 py-2 text-xs text-slate-500 flex justify-between">
          <span>🎨 文件 {stats.files} | 任务 {stats.tasks} | 成功 {stats.completed}</span>
          <span>Ctrl+R 执行 | Ctrl+E 导出 | ? 帮助</span>
        </div>
      </div>
    </div>
  );
}
