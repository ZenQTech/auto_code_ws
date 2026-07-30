/**
 * # ============================================================
 * # MultiTaskOrchestrationPanel - 多任务编排 UI (v1.1.0 Cycle 24 P2-2)
 * # ============================================================
 * # 核心作用：MultiTaskOrchestrator 的可视化控制面板
 * # 主要功能：
 * #   1. 统计 Dashboard（活跃/完成/失败/总成本/并发数/预算）
 * #   2. 任务列表（按状态/类型过滤、批量操作）
 * #   3. 创建任务向导（类型选择/描述/依赖/文件/优先级）
 * #   4. 任务详情侧栏（进度/日志/重试/取消）
 * #   5. 依赖图视图（任务顺序与依赖关系）
 * #   6. 冲突监控
 * #   7. 配置（并发/预算/策略）
 * #   8. 快捷键系统（Esc/?/Cmd+N/Cmd+B/Cmd+Shift+C）
 * #   9. 状态持久化 + 加载动画 + 错误重试 + 任务搜索防抖
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 24 G24-02 初次创建
 * #   - 2026-07-30 | v1.1.0 | P2-2 UI/UX 一致性增强
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  getMultiTaskOrchestrator,
  MULTI_TASK_TYPE_LABELS,
  MULTI_TASK_TYPE_ICONS,
  type MultiTask,
  type MultiTaskType,
  type MultiTaskStatus,
  type MultiTaskConfig,
  type OrchestrationStats,
  type TaskConflict,
  type CreateMultiTaskInput,
} from '../utils/multiTaskOrchestrator';
import { EmptyState } from './EmptyState';

interface MultiTaskOrchestrationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'tasks' | 'graph' | 'conflicts' | 'config';
type FilterStatus = 'all' | MultiTaskStatus;
type FilterType = 'all' | MultiTaskType;

const STATUS_COLORS: Record<MultiTaskStatus, string> = {
  pending: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  running: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  paused: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  completed: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  failed: 'bg-rose-500/20 text-rose-300 border-rose-500/30',
  cancelled: 'bg-slate-700/50 text-slate-400 border-slate-600/30',
};

const STATUS_LABELS: Record<MultiTaskStatus, string> = {
  pending: '待执行',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const TYPE_FILTERS: FilterType[] = ['all', 'requirement', 'architecture', 'implementation', 'testing', 'review', 'documentation', 'refactor', 'deployment'];
const STATUS_FILTERS: FilterStatus[] = ['all', 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'];

const STORAGE_KEY = 'hermes.multiTaskPanel';
const SEARCH_DEBOUNCE_MS = 200;

interface PersistedState {
  tab: TabKey;
  filterStatus: FilterStatus;
  filterType: FilterType;
}

function safeGet<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

export function MultiTaskOrchestrationPanel({ isOpen, onClose }: MultiTaskOrchestrationPanelProps) {
  const engine = useMemo(() => getMultiTaskOrchestrator(), []);
  const [tab, setTab] = useState<TabKey>('tasks');
  const [tasks, setTasks] = useState<MultiTask[]>([]);
  const [stats, setStats] = useState<OrchestrationStats>(engine.getStats());
  const [conflicts, setConflicts] = useState<TaskConflict[]>([]);
  const [config, setConfig] = useState<MultiTaskConfig>(engine.getConfig());
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [lastFailedAction, setLastFailedAction] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 恢复持久化
  useEffect(() => {
    if (!isOpen) return;
    const persisted = safeGet<PersistedState | null>(STORAGE_KEY, null);
    if (persisted) {
      if (persisted.tab) setTab(persisted.tab);
      if (persisted.filterStatus) setFilterStatus(persisted.filterStatus);
      if (persisted.filterType) setFilterType(persisted.filterType);
    }
  }, [isOpen]);

  // 持久化
  useEffect(() => {
    if (!isOpen) return;
    safeSet(STORAGE_KEY, { tab, filterStatus, filterType });
  }, [isOpen, tab, filterStatus, filterType]);

  // 搜索防抖
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const refresh = useCallback(() => {
    setTasks(engine.listTasks());
    setStats(engine.getStats());
    setConflicts(engine.getConflicts());
    setConfig(engine.getConfig());
  }, [engine]);

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const offs = [
      engine.on('task-created', refresh),
      engine.on('task-started', refresh),
      engine.on('task-progress', refresh),
      engine.on('task-paused', refresh),
      engine.on('task-resumed', refresh),
      engine.on('task-completed', refresh),
      engine.on('task-failed', refresh),
      engine.on('task-cancelled', refresh),
      engine.on('task-retried', refresh),
      engine.on('conflict-detected', refresh),
      engine.on('config-updated', refresh),
    ];
    return () => {
      offs.forEach((off) => off());
    };
  }, [isOpen, engine, refresh]);

  // 自动清除消息
  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 3000);
      return () => clearTimeout(t);
    }
  }, [error]);
  useEffect(() => {
    if (info) {
      const t = setTimeout(() => setInfo(null), 3000);
      return () => clearTimeout(t);
    }
  }, [info]);

  // 过滤 + 搜索
  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tasks.filter((t) => {
      if (filterStatus !== 'all' && t.status !== filterStatus) return false;
      if (filterType !== 'all' && t.type !== filterType) return false;
      if (q) {
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          MULTI_TASK_TYPE_LABELS[t.type].toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [tasks, filterStatus, filterType, searchQuery]);

  // 操作
  const handleStart = useCallback(
    (id: string) => {
      if (!engine.start(id)) {
        setError('无法启动（依赖未完成/并发数已满/预算超限/文件冲突）');
        setLastFailedAction('start');
      } else {
        setError(null);
        setInfo('已启动');
      }
    },
    [engine]
  );

  const handlePause = useCallback((id: string) => { engine.pause(id); }, [engine]);
  const handleResume = useCallback((id: string) => { engine.resume(id); }, [engine]);
  const handleCancel = useCallback(
    (id: string) => {
      if (!(globalThis as { confirm?: (msg: string) => boolean }).confirm?.('确认取消此任务？')) return;
      engine.cancel(id);
      setInfo('已取消');
    },
    [engine]
  );
  const handleRetry = useCallback(
    (id: string) => {
      if (!engine.retry(id)) {
        setError('无法重试（次数用尽或状态不允许）');
        setLastFailedAction('retry');
      } else {
        setInfo('已重新启动');
      }
    },
    [engine]
  );

  const handleBatchStart = useCallback(async () => {
    setBusyAction('batch-start');
    try {
      await new Promise((r) => setTimeout(r, 30));
      const n = engine.startBatch();
      if (n === 0) {
        setError('无可启动任务');
        setLastFailedAction('batch-start');
      } else {
        setInfo(`已批量启动 ${n} 个任务`);
      }
    } finally {
      setBusyAction(null);
    }
  }, [engine]);

  const handleBatchCancel = useCallback(() => {
    if (!(globalThis as { confirm?: (msg: string) => boolean }).confirm?.('确认取消所有运行中的任务？')) return;
    const running = engine.getRunningTasks();
    running.forEach((t) => engine.cancel(t.id));
    setInfo(`已取消 ${running.length} 个任务`);
  }, [engine]);

  const handleUpdateConfig = useCallback(
    (patch: Partial<MultiTaskConfig>) => {
      engine.updateConfig(patch);
    },
    [engine]
  );

  // 重试上次失败操作
  const handleRetryLast = useCallback(() => {
    if (!lastFailedAction) return;
    setRetryCount((c) => c + 1);
    setError(null);
    setLastFailedAction(null);
    if (lastFailedAction === 'batch-start') handleBatchStart();
  }, [lastFailedAction, handleBatchStart]);

  // 键盘快捷键
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT';

      // Esc 关闭 / 退出
      if (e.key === 'Escape') {
        if (showShortcuts) { setShowShortcuts(false); return; }
        if (showCreateForm) { setShowCreateForm(false); return; }
        if (selectedId) { setSelectedId(null); return; }
        e.preventDefault();
        onClose();
        return;
      }
      // ? 显示快捷键
      if (e.key === '?' && !e.shiftKey && !inInput) {
        e.preventDefault();
        setShowShortcuts((s) => !s);
        return;
      }
      // Cmd/Ctrl + N = 新建任务
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        setShowCreateForm(true);
        return;
      }
      // Cmd/Ctrl + B = 批量启动
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'b') {
        e.preventDefault();
        handleBatchStart();
        return;
      }
      // Cmd/Ctrl + Shift + C = 批量取消
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        handleBatchCancel();
        return;
      }
      // Cmd/Ctrl + F = 聚焦搜索
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose, selectedId, showCreateForm, showShortcuts, handleBatchStart, handleBatchCancel]);

  if (!isOpen) return null;

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'tasks', label: '任务', icon: '📋' },
    { key: 'graph', label: '依赖图', icon: '🕸️' },
    { key: 'conflicts', label: '冲突', icon: '⚠️' },
    { key: 'config', label: '配置', icon: '⚙️' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="multi-task-panel"
      onClick={onClose}
    >
      <div
        className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-2xl shadow-2xl w-[95vw] max-w-7xl h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
              <span className="text-white text-sm">🧠</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">多任务并行编排</h2>
              <p className="text-xs text-slate-400">
                并行执行 · 依赖编排 · 冲突避免 · 预算控制
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowShortcuts(!showShortcuts)}
              data-testid="multi-task-shortcuts-btn"
              className="w-7 h-7 text-xs text-slate-400 hover:text-white border border-surface-700 rounded-full bg-surface-900 hover:bg-surface-700 transition flex items-center justify-center"
              title="快捷键 (?)"
            >
              ?
            </button>
            <button
              onClick={onClose}
              data-testid="multi-task-close"
              className="text-slate-400 hover:text-white text-2xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-surface-700 transition"
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        {/* Top Stats Bar */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-2 p-3 border-b border-surface-700 bg-surface-800/30">
          <StatCard label="总任务" value={stats.totalTasks} color="text-white" testId="stat-total" />
          <StatCard label="运行中" value={stats.runningTasks} color="text-blue-400" testId="stat-running" />
          <StatCard label="已完成" value={stats.completedTasks} color="text-emerald-400" testId="stat-completed" />
          <StatCard label="失败" value={stats.failedTasks} color="text-rose-400" testId="stat-failed" />
          <StatCard label="并发" value={`${stats.runningTasks}/${engine.getConfig().maxConcurrent}`} color="text-cyan-400" testId="stat-concurrency" />
          <StatCard label="总成本" value={`$${stats.totalCost.toFixed(2)}`} color="text-amber-400" testId="stat-cost" />
          <StatCard label="预算" value={`${(stats.budgetUsage * 100).toFixed(0)}%`} color="text-violet-400" testId="stat-budget" />
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700 bg-surface-800/50">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`multi-task-tab-${t.key}`}
              className={`px-4 py-2 text-sm transition ${
                tab === t.key
                  ? 'text-white border-b-2 border-primary-500'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.icon} {t.label}
              {t.key === 'conflicts' && conflicts.length > 0 && (
                <span className="ml-2 px-1.5 py-0.5 bg-rose-500/30 text-rose-200 text-xs rounded">
                  {conflicts.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Toast 消息区域（顶部居中） */}
        {(error || info) && (
          <div
            data-testid="multi-task-toast"
            className={`absolute top-32 left-1/2 -translate-x-1/2 z-20 p-3 rounded text-sm flex items-center gap-2 shadow-lg animate-in slide-in-from-top-2 duration-200 ${
              error
                ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
            }`}
          >
            {error && lastFailedAction && (
              <button
                onClick={handleRetryLast}
                data-testid="multi-task-retry"
                className="px-2 py-0.5 bg-rose-500/30 hover:bg-rose-500/40 text-rose-200 text-xs rounded"
              >
                🔄 重试 {retryCount > 0 && `(${retryCount})`}
              </button>
            )}
            <span>{error || info}</span>
            <button
              onClick={() => { setError(null); setInfo(null); setLastFailedAction(null); }}
              data-testid="multi-task-toast-close"
              className="ml-2 text-slate-400 hover:text-white"
            >
              ✕
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-hidden flex">
          {tab === 'tasks' && (
            <TasksTab
              tasks={filtered}
              allTasks={tasks}
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              filterType={filterType}
              setFilterType={setFilterType}
              searchInput={searchInput}
              setSearchInput={setSearchInput}
              searchQuery={searchQuery}
              searchInputRef={searchInputRef}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onStart={handleStart}
              onPause={handlePause}
              onResume={handleResume}
              onCancel={handleCancel}
              onRetry={handleRetry}
              onCreateNew={() => setShowCreateForm(true)}
              onBatchStart={handleBatchStart}
              onBatchCancel={handleBatchCancel}
              busyAction={busyAction}
            />
          )}

          {tab === 'graph' && <DependencyGraphTab tasks={tasks} onSelect={setSelectedId} />}

          {tab === 'conflicts' && <ConflictsTab conflicts={conflicts} tasks={tasks} onClear={() => { engine.clearConflicts(); refresh(); }} />}

          {tab === 'config' && (
            <ConfigTab
              config={config}
              stats={stats}
              onUpdate={handleUpdateConfig}
            />
          )}
        </div>

        {/* Create Task Drawer */}
        {showCreateForm && (
          <CreateTaskDrawer
            tasks={tasks}
            onClose={() => setShowCreateForm(false)}
            onCreate={(input) => {
              engine.createTask(input);
              setShowCreateForm(false);
              setInfo('任务已创建');
            }}
          />
        )}

        {/* Task Detail Drawer */}
        {selectedId && (
          <TaskDetailDrawer
            task={engine.getTask(selectedId)}
            allTasks={tasks}
            onClose={() => setSelectedId(null)}
            onStart={handleStart}
            onPause={handlePause}
            onResume={handleResume}
            onCancel={handleCancel}
            onRetry={handleRetry}
          />
        )}

        {/* 快捷键帮助面板 */}
        {showShortcuts && (
          <div
            data-testid="multi-task-shortcuts-panel"
            className="absolute top-14 right-12 z-50 bg-surface-900 border border-surface-700 rounded-lg shadow-2xl p-3 min-w-[280px] animate-in fade-in slide-in-from-top-2 duration-200"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-white">⌨️ 快捷键</span>
              <button
                onClick={() => setShowShortcuts(false)}
                data-testid="multi-task-shortcuts-close"
                className="text-slate-400 hover:text-white text-sm w-5 h-5"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <ul className="space-y-1.5 text-[11px]">
              <li className="flex items-center justify-between">
                <span className="text-slate-300">关闭面板</span>
                <kbd className="px-1.5 py-0.5 bg-surface-800 border border-surface-700 rounded text-slate-400">Esc</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-300">显示快捷键</span>
                <kbd className="px-1.5 py-0.5 bg-surface-800 border border-surface-700 rounded text-slate-400">?</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-300">新建任务</span>
                <kbd className="px-1.5 py-0.5 bg-surface-800 border border-surface-700 rounded text-slate-400">⌘/Ctrl + N</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-300">批量启动</span>
                <kbd className="px-1.5 py-0.5 bg-surface-800 border border-surface-700 rounded text-slate-400">⌘/Ctrl + B</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-300">批量取消</span>
                <kbd className="px-1.5 py-0.5 bg-surface-800 border border-surface-700 rounded text-slate-400">⌘/Ctrl + ⇧ + C</kbd>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-slate-300">聚焦搜索</span>
                <kbd className="px-1.5 py-0.5 bg-surface-800 border border-surface-700 rounded text-slate-400">⌘/Ctrl + F</kbd>
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ============== 子组件 ==============

function StatCard({ label, value, color, testId }: { label: string; value: string | number; color: string; testId?: string }) {
  return (
    <div className="bg-surface-800/50 border border-surface-700 rounded p-2" data-testid={testId}>
      <div className="text-[10px] text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
    </div>
  );
}

function TasksTab(props: {
  tasks: MultiTask[];
  allTasks: MultiTask[];
  filterStatus: FilterStatus;
  setFilterStatus: (s: FilterStatus) => void;
  filterType: FilterType;
  setFilterType: (t: FilterType) => void;
  searchInput: string;
  setSearchInput: (v: string) => void;
  searchQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onCreateNew: () => void;
  onBatchStart: () => void;
  onBatchCancel: () => void;
  busyAction: string | null;
}) {
  const { tasks, allTasks, filterStatus, setFilterStatus, filterType, setFilterType, searchInput, setSearchInput, searchQuery, searchInputRef, onSelect, onStart, onPause, onResume, onCancel, onRetry, onCreateNew, onBatchStart, onBatchCancel, busyAction } = props;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-surface-700 bg-surface-800/30">
        <button
          onClick={onCreateNew}
          data-testid="create-task"
          className="px-3 py-1.5 bg-primary-500 text-white rounded text-sm hover:bg-primary-600"
          title="新建任务 (Cmd/Ctrl+N)"
        >
          ➕ 创建任务
        </button>
        <button
          onClick={onBatchStart}
          disabled={busyAction === 'batch-start'}
          data-testid="batch-start"
          className="px-3 py-1.5 bg-emerald-500/80 text-white rounded text-sm hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-1"
          title="批量启动 (Cmd/Ctrl+B)"
        >
          {busyAction === 'batch-start' && (
            <span className="inline-block w-2.5 h-2.5 border border-white border-t-transparent rounded-full animate-spin" />
          )}
          ▶ 批量启动
        </button>
        <button
          onClick={onBatchCancel}
          data-testid="batch-cancel"
          className="px-3 py-1.5 bg-rose-500/80 text-white rounded text-sm hover:bg-rose-600"
          title="批量取消 (Cmd/Ctrl+Shift+C)"
        >
          ⏹ 全部取消
        </button>
        <input
          ref={searchInputRef}
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="🔍 搜索任务名/描述/类型..."
          data-testid="task-search"
          className="flex-1 min-w-[200px] px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-xs text-white focus:border-primary-500 focus:outline-none"
        />
        {searchInput && (
          <button
            onClick={() => setSearchInput('')}
            data-testid="task-search-clear"
            className="px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white border border-surface-700 rounded"
          >
            ✕
          </button>
        )}
        {searchInput !== searchQuery && (
          <span data-testid="task-search-debounce" className="text-[10px] text-slate-500 animate-pulse">
            搜索中...
          </span>
        )}
        <div className="flex items-center gap-1">
          <label className="text-xs text-slate-400">状态</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
            data-testid="filter-status"
            className="px-2 py-1 bg-surface-800 border border-surface-700 rounded text-xs text-white"
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? '全部' : STATUS_LABELS[s as MultiTaskStatus]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <label className="text-xs text-slate-400">类型</label>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as FilterType)}
            data-testid="filter-type"
            className="px-2 py-1 bg-surface-800 border border-surface-700 rounded text-xs text-white"
          >
            {TYPE_FILTERS.map((t) => (
              <option key={t} value={t}>
                {t === 'all' ? '全部' : MULTI_TASK_TYPE_LABELS[t as MultiTaskType]}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-slate-500 ml-auto">{tasks.length} 个任务</span>
      </div>

      {/* Task Grid */}
      <div className="flex-1 overflow-y-auto p-3">
        {tasks.length === 0 ? (
          <EmptyState
            icon="🧠"
            title="暂无任务"
            description="创建你的第一个多任务编排任务以启动并行 vibe coding"
            action={{ label: '创建任务', onClick: onCreateNew, testId: 'empty-create' }}
            tone="info"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tasks.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                allTasks={allTasks}
                onClick={() => onSelect(t.id)}
                onStart={() => onStart(t.id)}
                onPause={() => onPause(t.id)}
                onResume={() => onResume(t.id)}
                onCancel={() => onCancel(t.id)}
                onRetry={() => onRetry(t.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard(props: {
  task: MultiTask;
  allTasks: MultiTask[];
  onClick: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const { task, onClick, onStart, onPause, onResume, onCancel, onRetry } = props;
  const icon = MULTI_TASK_TYPE_ICONS[task.type];
  return (
    <div
      data-testid={`task-card-${task.id}`}
      className="bg-surface-800/60 border border-surface-700 rounded-lg p-3 hover:border-primary-500/40 transition cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{icon}</span>
          <div className="min-w-0">
            <div className="text-sm font-medium text-white truncate">{task.name}</div>
            <div className="text-[10px] text-slate-400">{MULTI_TASK_TYPE_LABELS[task.type]}</div>
          </div>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLORS[task.status]}`}>
          {STATUS_LABELS[task.status]}
        </span>
      </div>

      {task.description && (
        <p className="text-xs text-slate-400 line-clamp-2 mb-2">{task.description}</p>
      )}

      <div className="space-y-1 mb-2">
        <div className="flex justify-between text-[10px] text-slate-400">
          <span>进度</span>
          <span>{task.progress}%</span>
        </div>
        <div className="h-1.5 bg-surface-700 rounded overflow-hidden">
          <div
            className={`h-full ${
              task.status === 'failed'
                ? 'bg-rose-500'
                : task.status === 'completed'
                ? 'bg-emerald-500'
                : 'bg-primary-500'
            }`}
            style={{ width: `${task.progress}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-slate-500">
        <span>P{task.priority} · {task.completedSteps}/{task.totalSteps}</span>
        <span>${task.costSoFar.toFixed(3)}</span>
      </div>

      {task.currentStep && (
        <div className="mt-1 text-[10px] text-cyan-400 truncate" title={task.currentStep}>
          → {task.currentStep}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mt-2 pt-2 border-t border-surface-700/50" onClick={(e) => e.stopPropagation()}>
        {task.status === 'pending' && (
          <button
            onClick={onStart}
            data-testid={`task-start-${task.id}`}
            className="text-[10px] px-2 py-0.5 bg-emerald-500/30 text-emerald-200 rounded hover:bg-emerald-500/50"
          >
            ▶ 启动
          </button>
        )}
        {task.status === 'running' && (
          <button
            onClick={onPause}
            data-testid={`task-pause-${task.id}`}
            className="text-[10px] px-2 py-0.5 bg-amber-500/30 text-amber-200 rounded hover:bg-amber-500/50"
          >
            ⏸ 暂停
          </button>
        )}
        {task.status === 'paused' && (
          <button
            onClick={onResume}
            data-testid={`task-resume-${task.id}`}
            className="text-[10px] px-2 py-0.5 bg-blue-500/30 text-blue-200 rounded hover:bg-blue-500/50"
          >
            ▶ 恢复
          </button>
        )}
        {(task.status === 'failed' || task.status === 'cancelled') && task.retryCount < task.maxRetries && (
          <button
            onClick={onRetry}
            data-testid={`task-retry-${task.id}`}
            className="text-[10px] px-2 py-0.5 bg-cyan-500/30 text-cyan-200 rounded hover:bg-cyan-500/50"
          >
            🔄 重试 ({task.retryCount}/{task.maxRetries})
          </button>
        )}
        {(task.status === 'pending' || task.status === 'running' || task.status === 'paused') && (
          <button
            onClick={onCancel}
            data-testid={`task-cancel-${task.id}`}
            className="text-[10px] px-2 py-0.5 bg-rose-500/30 text-rose-200 rounded hover:bg-rose-500/50"
          >
            ✕ 取消
          </button>
        )}
      </div>
    </div>
  );
}

function DependencyGraphTab(props: { tasks: MultiTask[]; onSelect: (id: string) => void }) {
  const { tasks, onSelect } = props;
  const sorted = useMemo(() => {
    const engine = getMultiTaskOrchestrator();
    return engine.resolveDependencies();
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="flex-1 p-6">
        <EmptyState
          icon="🕸️"
          title="暂无任务"
          description="创建任务后将在此显示依赖关系图"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="text-xs text-slate-400 mb-3">
        拓扑排序（{sorted.length} 个任务，按优先级排序）
      </div>
      <div className="space-y-2">
        {sorted.map((task, idx) => {
          const deps = task.dependsOn
            .map((id) => tasks.find((t) => t.id === id))
            .filter(Boolean) as MultiTask[];
          return (
            <div key={task.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-surface-800 border border-primary-500/40 flex items-center justify-center text-[10px] text-primary-300">
                  {idx + 1}
                </div>
                {idx < sorted.length - 1 && (
                  <div className="w-px flex-1 bg-surface-700 min-h-[24px]" />
                )}
              </div>
              <div
                data-testid={`graph-node-${task.id}`}
                onClick={() => onSelect(task.id)}
                className="flex-1 bg-surface-800/60 border border-surface-700 rounded p-2 hover:border-primary-500/40 transition cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span>{MULTI_TASK_TYPE_ICONS[task.type]}</span>
                    <span className="text-sm text-white">{task.name}</span>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_COLORS[task.status]}`}>
                    {STATUS_LABELS[task.status]}
                  </span>
                </div>
                {deps.length > 0 && (
                  <div className="mt-1 text-[10px] text-slate-400">
                    依赖: {deps.map((d) => d.name).join(', ')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConflictsTab(props: {
  conflicts: TaskConflict[];
  tasks: MultiTask[];
  onClear: () => void;
}) {
  const { conflicts, tasks, onClear } = props;
  if (conflicts.length === 0) {
    return (
      <div className="flex-1 p-6">
        <EmptyState
          icon="✅"
          title="无冲突"
          description="所有任务的资源分配无冲突"
          tone="success"
        />
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-white">检测到 {conflicts.length} 个文件冲突</div>
        <button
          onClick={onClear}
          data-testid="clear-conflicts"
          className="px-2 py-1 bg-surface-800 border border-surface-700 rounded text-xs text-slate-300 hover:bg-surface-700"
        >
          清除历史
        </button>
      </div>
      <div className="space-y-2">
        {conflicts.map((c, idx) => {
          const a = tasks.find((t) => t.id === c.taskA);
          const b = tasks.find((t) => t.id === c.taskB);
          return (
            <div
              key={idx}
              data-testid={`conflict-${idx}`}
              className="bg-rose-500/10 border border-rose-500/30 rounded p-3"
            >
              <div className="text-sm text-rose-200 mb-1">
                {a?.name || c.taskA} ⚡ {b?.name || c.taskB}
              </div>
              <div className="text-xs text-rose-300">
                冲突文件: {c.files.join(', ')}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConfigTab(props: {
  config: MultiTaskConfig;
  stats: OrchestrationStats;
  onUpdate: (patch: Partial<MultiTaskConfig>) => void;
}) {
  const { config, stats, onUpdate } = props;
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      <div className="bg-surface-800/60 border border-surface-700 rounded p-3">
        <h3 className="text-sm font-medium text-white mb-2">执行控制</h3>
        <div className="space-y-2">
          <SliderRow
            label="最大并发"
            value={config.maxConcurrent}
            min={1}
            max={20}
            onChange={(v) => onUpdate({ maxConcurrent: v })}
            testId="config-max-concurrent"
          />
          <SliderRow
            label="单任务预算 ($)"
            value={config.perTaskBudget}
            min={0.1}
            max={10}
            step={0.1}
            onChange={(v) => onUpdate({ perTaskBudget: v })}
            testId="config-per-task-budget"
          />
          <SliderRow
            label="总预算 ($)"
            value={config.totalBudget}
            min={1}
            max={100}
            onChange={(v) => onUpdate({ totalBudget: v })}
            testId="config-total-budget"
          />
        </div>
      </div>

      <div className="bg-surface-800/60 border border-surface-700 rounded p-3">
        <h3 className="text-sm font-medium text-white mb-2">行为</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-300">冲突策略</label>
            <select
              value={config.conflictPolicy}
              onChange={(e) => onUpdate({ conflictPolicy: e.target.value as any })}
              data-testid="config-conflict-policy"
              className="px-2 py-1 bg-surface-800 border border-surface-700 rounded text-xs text-white"
            >
              <option value="detect">detect（检测）</option>
              <option value="queue">queue（排队）</option>
              <option value="allow">allow（允许）</option>
            </select>
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-300">自动启动</label>
            <input
              type="checkbox"
              checked={config.autoStart}
              onChange={(e) => onUpdate({ autoStart: e.target.checked })}
              data-testid="config-auto-start"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-300">Worktree 隔离</label>
            <input
              type="checkbox"
              checked={config.worktreeIsolation}
              onChange={(e) => onUpdate({ worktreeIsolation: e.target.checked })}
              data-testid="config-worktree"
            />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-xs text-slate-300">最大重试次数</label>
            <input
              type="number"
              value={config.maxRetries}
              min={0}
              max={10}
              onChange={(e) => onUpdate({ maxRetries: parseInt(e.target.value, 10) || 0 })}
              data-testid="config-max-retries"
              className="w-16 px-2 py-1 bg-surface-800 border border-surface-700 rounded text-xs text-white"
            />
          </div>
        </div>
      </div>

      <div className="bg-surface-800/60 border border-surface-700 rounded p-3">
        <h3 className="text-sm font-medium text-white mb-2">实时统计</h3>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="总任务" value={stats.totalTasks} />
          <Stat label="运行中" value={stats.runningTasks} />
          <Stat label="待执行" value={stats.pendingTasks} />
          <Stat label="已完成" value={stats.completedTasks} />
          <Stat label="失败" value={stats.failedTasks} />
          <Stat label="已取消" value={stats.cancelledTasks} />
          <Stat label="总成本" value={`$${stats.totalCost.toFixed(3)}`} />
          <Stat label="剩余预算" value={`$${Math.max(0, config.totalBudget - stats.totalCost).toFixed(3)}`} />
          <Stat label="总 Token (in)" value={stats.totalTokens.input} />
          <Stat label="总 Token (out)" value={stats.totalTokens.output} />
          <Stat label="平均耗时" value={`${(stats.averageDurationMs / 1000).toFixed(1)}s`} />
          <Stat label="冲突数" value={stats.conflictCount} />
        </div>
      </div>
    </div>
  );
}

function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  testId?: string;
}) {
  const { label, value, min, max, step, onChange, testId } = props;
  return (
    <div className="flex items-center gap-3">
      <label className="text-xs text-slate-300 w-32">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step || 1}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        data-testid={testId}
        className="flex-1"
      />
      <span className="text-xs text-white w-16 text-right">{value}</span>
    </div>
  );
}

function Stat(props: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{props.label}</span>
      <span className="text-white">{props.value}</span>
    </div>
  );
}

function CreateTaskDrawer(props: {
  tasks: MultiTask[];
  onClose: () => void;
  onCreate: (input: CreateMultiTaskInput) => void;
}) {
  const { tasks, onClose, onCreate } = props;
  const [name, setName] = useState('');
  const [type, setType] = useState<MultiTaskType>('implementation');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(5);
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [files, setFiles] = useState('');
  const [totalSteps, setTotalSteps] = useState(10);
  const [model, setModel] = useState('claude-sonnet-4-5');

  const handleSubmit = () => {
    if (!name.trim()) {
      // eslint-disable-next-line no-alert
      alert('请输入任务名');
      return;
    }
    const fileList = files.split(',').map((f) => f.trim()).filter(Boolean);
    onCreate({
      name: name.trim(),
      type,
      description: description.trim(),
      priority,
      dependsOn,
      totalSteps,
      files: fileList,
      model,
      maxRetries: 2,
      metadata: {},
    });
  };

  return (
    <div
      className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center animate-in fade-in duration-200"
      data-testid="create-task-drawer"
      onClick={onClose}
    >
      <div
        className="bg-surface-900 border border-surface-700 rounded-lg p-5 w-[480px] max-w-[90vw] max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom-2 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-white mb-3">创建任务</h3>
        <div className="space-y-3">
          <FormRow label="任务名 *">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="create-name"
              placeholder="例如：实现用户认证"
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm text-white"
            />
          </FormRow>
          <FormRow label="类型">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MultiTaskType)}
              data-testid="create-type"
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm text-white"
            >
              {(['requirement', 'architecture', 'implementation', 'testing', 'review', 'documentation', 'refactor', 'deployment'] as MultiTaskType[]).map((t) => (
                <option key={t} value={t}>{MULTI_TASK_TYPE_ICONS[t]} {MULTI_TASK_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="描述">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              data-testid="create-description"
              rows={2}
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm text-white"
            />
          </FormRow>
          <FormRow label="优先级 (0-9)">
            <input
              type="number"
              min={0}
              max={9}
              value={priority}
              onChange={(e) => setPriority(parseInt(e.target.value, 10) || 0)}
              data-testid="create-priority"
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm text-white"
            />
          </FormRow>
          <FormRow label="总步骤数">
            <input
              type="number"
              min={1}
              value={totalSteps}
              onChange={(e) => setTotalSteps(parseInt(e.target.value, 10) || 1)}
              data-testid="create-steps"
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm text-white"
            />
          </FormRow>
          <FormRow label="涉及文件（逗号分隔）">
            <input
              type="text"
              value={files}
              onChange={(e) => setFiles(e.target.value)}
              data-testid="create-files"
              placeholder="src/auth.ts, src/types.ts"
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm text-white"
            />
          </FormRow>
          <FormRow label="依赖任务">
            <select
              multiple
              value={dependsOn}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
                setDependsOn(selected);
              }}
              data-testid="create-depends"
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm text-white h-20"
            >
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({MULTI_TASK_TYPE_LABELS[t.type]})
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="模型">
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              data-testid="create-model"
              className="w-full px-2 py-1.5 bg-surface-800 border border-surface-700 rounded text-sm text-white"
            />
          </FormRow>
        </div>
        <div className="flex gap-2 mt-4 pt-3 border-t border-surface-700">
          <button
            onClick={handleSubmit}
            data-testid="create-submit"
            className="flex-1 px-3 py-1.5 bg-primary-500 text-white rounded text-sm hover:bg-primary-600"
          >
            创建
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-surface-700 text-white rounded text-sm hover:bg-surface-600"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

function FormRow(props: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{props.label}</label>
      {props.children}
    </div>
  );
}

function TaskDetailDrawer(props: {
  task: MultiTask | null;
  allTasks: MultiTask[];
  onClose: () => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const { task, allTasks, onClose, onStart, onPause, onResume, onCancel, onRetry } = props;
  if (!task) return null;
  const deps = task.dependsOn.map((id) => allTasks.find((t) => t.id === id)).filter(Boolean) as MultiTask[];
  const dependents = allTasks.filter((t) => t.dependsOn.includes(task.id));

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-[420px] bg-surface-900 border-l border-surface-700 flex flex-col z-10 animate-in slide-in-from-right-2 duration-200"
      data-testid="task-detail"
    >
      <div className="flex items-center justify-between p-3 border-b border-surface-700">
        <h3 className="text-sm font-semibold text-white">任务详情</h3>
        <button
          onClick={onClose}
          data-testid="detail-close"
          className="text-slate-400 hover:text-white text-xl leading-none w-6 h-6 flex items-center justify-center rounded hover:bg-surface-700"
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        <Section title="基本信息">
          <KV k="ID" v={task.id} />
          <KV k="名称" v={task.name} />
          <KV k="类型" v={`${MULTI_TASK_TYPE_ICONS[task.type]} ${MULTI_TASK_TYPE_LABELS[task.type]}`} />
          <KV k="状态" v={STATUS_LABELS[task.status]} />
          <KV k="优先级" v={`P${task.priority}`} />
          <KV k="模型" v={task.model} />
          <KV k="描述" v={task.description || '-'} />
        </Section>
        <Section title="进度">
          <KV k="进度" v={`${task.progress}%`} />
          <KV k="已完成步骤" v={`${task.completedSteps} / ${task.totalSteps}`} />
          {task.currentStep && <KV k="当前步骤" v={task.currentStep} />}
          {task.startedAt && <KV k="开始时间" v={new Date(task.startedAt).toLocaleString()} />}
          {task.finishedAt && <KV k="结束时间" v={new Date(task.finishedAt).toLocaleString()} />}
          {task.actualDurationMs !== undefined && <KV k="实际耗时" v={`${(task.actualDurationMs / 1000).toFixed(1)}s`} />}
          {task.estimatedDurationMs !== undefined && <KV k="预计耗时" v={`${(task.estimatedDurationMs / 1000).toFixed(1)}s`} />}
        </Section>
        <Section title="资源">
          <KV k="成本" v={`$${task.costSoFar.toFixed(4)}`} />
          <KV k="Input tokens" v={String(task.tokensConsumed.input)} />
          <KV k="Output tokens" v={String(task.tokensConsumed.output)} />
          <KV k="重试次数" v={`${task.retryCount} / ${task.maxRetries}`} />
        </Section>
        {task.files.length > 0 && (
          <Section title="涉及文件">
            <div className="text-slate-300 font-mono">
              {task.files.map((f) => <div key={f}>{f}</div>)}
            </div>
          </Section>
        )}
        {deps.length > 0 && (
          <Section title="依赖">
            <ul className="text-slate-300">
              {deps.map((d) => <li key={d.id}>→ {d.name} ({STATUS_LABELS[d.status]})</li>)}
            </ul>
          </Section>
        )}
        {dependents.length > 0 && (
          <Section title="下游">
            <ul className="text-slate-300">
              {dependents.map((d) => <li key={d.id}>← {d.name} ({STATUS_LABELS[d.status]})</li>)}
            </ul>
          </Section>
        )}
        {task.error && (
          <Section title="错误">
            <div className="bg-rose-500/10 border border-rose-500/30 rounded p-2 text-rose-300">
              <div className="font-mono">[{task.error.code}]</div>
              <div>{task.error.message}</div>
            </div>
          </Section>
        )}
        {task.result && (
          <Section title="结果">
            <pre className="bg-surface-800 border border-surface-700 rounded p-2 text-slate-300 whitespace-pre-wrap break-words">
              {task.result}
            </pre>
          </Section>
        )}
      </div>
      <div className="p-3 border-t border-surface-700 flex flex-wrap gap-2">
        {task.status === 'pending' && (
          <button onClick={() => onStart(task.id)} className="px-2 py-1 bg-emerald-500/80 text-white rounded text-xs">▶ 启动</button>
        )}
        {task.status === 'running' && (
          <button onClick={() => onPause(task.id)} className="px-2 py-1 bg-amber-500/80 text-white rounded text-xs">⏸ 暂停</button>
        )}
        {task.status === 'paused' && (
          <button onClick={() => onResume(task.id)} className="px-2 py-1 bg-blue-500/80 text-white rounded text-xs">▶ 恢复</button>
        )}
        {(task.status === 'failed' || task.status === 'cancelled') && task.retryCount < task.maxRetries && (
          <button onClick={() => onRetry(task.id)} className="px-2 py-1 bg-cyan-500/80 text-white rounded text-xs">🔄 重试</button>
        )}
        {(task.status === 'pending' || task.status === 'running' || task.status === 'paused') && (
          <button onClick={() => onCancel(task.id)} className="px-2 py-1 bg-rose-500/80 text-white rounded text-xs">✕ 取消</button>
        )}
      </div>
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-800/40 border border-surface-700 rounded p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">{props.title}</div>
      <div className="space-y-1">{props.children}</div>
    </div>
  );
}

function KV(props: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{props.k}</span>
      <span className="text-slate-200 text-right break-all">{props.v}</span>
    </div>
  );
}
