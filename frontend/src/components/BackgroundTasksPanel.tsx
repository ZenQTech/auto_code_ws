/**
 * # ============================================================
 * # BackgroundTasksPanel - 后台任务面板 (v1.0.0 Cycle 19 G19-01)
 * # ============================================================
 * # 核心作用：展示所有后台任务（运行中/历史），支持筛选/搜索/操作
 * # 运行流程：
 * #   1. 通过 useBackgroundTasks hook 订阅 engine
 * #   2. 展示任务卡片（type / title / status / progress / duration）
 * #   3. 提供操作：pause / resume / cancel / retry / open
 * #   4. 任务完成时弹 toast 通知
 * # 输入参数：isOpen / onClose / apiBase
 * # 输出结果：JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 19 G19-01 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getBackgroundTaskEngine,
  type BackgroundTask,
  type TaskStatus,
  type TaskType,
} from '../utils/backgroundTaskEngine';

export interface BackgroundTasksPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskClick?: (task: BackgroundTask) => void;
}

type StatusFilter = 'all' | 'active' | 'done' | 'error';
type SortBy = 'created' | 'duration' | 'title';

const STATUS_BADGE: Record<TaskStatus, { label: string; className: string; icon: string }> = {
  pending: { label: '等待', className: 'bg-slate-500/20 text-slate-300', icon: '⏳' },
  queued: { label: '排队', className: 'bg-slate-500/20 text-slate-300', icon: '⌛' },
  running: { label: '运行中', className: 'bg-blue-500/20 text-blue-300', icon: '⚡' },
  waiting: { label: '等待输入', className: 'bg-yellow-500/20 text-yellow-300', icon: '🔔' },
  paused: { label: '已暂停', className: 'bg-yellow-500/20 text-yellow-300', icon: '⏸' },
  done: { label: '已完成', className: 'bg-green-500/20 text-green-300', icon: '✓' },
  error: { label: '错误', className: 'bg-red-500/20 text-red-300', icon: '✗' },
  cancelled: { label: '已取消', className: 'bg-slate-500/20 text-slate-400', icon: '⊘' },
};

const TYPE_ICON: Record<TaskType, string> = {
  composer: '🎼',
  agent: '🤖',
  review: '🔍',
  'best-of-n': '⚖️',
  brainstorm: '💡',
};

const TYPE_NAME: Record<TaskType, string> = {
  composer: 'Composer',
  agent: 'Agent',
  review: '代码审查',
  'best-of-n': 'Best-of-N',
  brainstorm: 'Brainstorm',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function BackgroundTasksPanel({ isOpen, onClose, onTaskClick }: BackgroundTasksPanelProps) {
  const engine = useMemo(() => getBackgroundTaskEngine(), []);
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('created');
  const [columns, setColumns] = useState<1 | 2 | 3 | 4>(2);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);

  // 订阅任务变化
  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => {
      setTasks(engine.listTasks());
    };
    refresh();
    const unsub = engine.on('updated', refresh);
    return () => {
      unsub();
    };
  }, [engine, isOpen]);

  // 过滤 + 排序
  const filteredTasks = useMemo(() => {
    let result = [...tasks];
    if (statusFilter === 'active') {
      result = result.filter(t => ['pending', 'queued', 'running', 'waiting', 'paused'].includes(t.status));
    } else if (statusFilter === 'done') {
      result = result.filter(t => t.status === 'done');
    } else if (statusFilter === 'error') {
      result = result.filter(t => t.status === 'error' || t.status === 'cancelled');
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t => t.title.toLowerCase().includes(q));
    }
    result.sort((a, b) => {
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'duration') {
        return (b.duration ?? 0) - (a.duration ?? 0);
      }
      return b.createdAt - a.createdAt;
    });
    return result;
  }, [tasks, statusFilter, searchQuery, sortBy]);

  const stats = useMemo(() => engine.getStats(), [engine, tasks]);

  const handlePause = useCallback((id: string) => {
    try {
      engine.pauseTask(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }
  }, [engine]);

  const handleResume = useCallback((id: string) => {
    try {
      engine.resumeTask(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }
  }, [engine]);

  const handleCancel = useCallback((id: string) => {
    setShowConfirm(null);
    try {
      engine.cancelTask(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }
  }, [engine]);

  const handleRetry = useCallback((id: string) => {
    try {
      engine.retryTask(id);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }
  }, [engine]);

  const handleClearHistory = useCallback(() => {
    engine.clearHistory();
  }, [engine]);

  // v6.41.0 P5 UI 优化：Esc 键关闭面板
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showConfirm) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, showConfirm]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="background-tasks-panel"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col animate-in fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700">
          <div>
            <h2 className="text-lg font-semibold text-surface-50">后台任务</h2>
            <p className="text-xs text-surface-400 mt-1">
              运行 {stats.active} 个 · 总计 {stats.total} · 已完成 {stats.done} · 错误 {stats.error}
            </p>
          </div>
          <button
            data-testid="background-tasks-close"
            onClick={onClose}
            className="text-surface-400 hover:text-surface-100 px-2"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-surface-700">
          <div className="flex items-center gap-1">
            {(['all', 'active', 'done', 'error'] as StatusFilter[]).map(filter => (
              <button
                key={filter}
                data-testid={`status-filter-${filter}`}
                onClick={() => setStatusFilter(filter)}
                className={[
                  'px-2 py-1 text-xs rounded',
                  statusFilter === filter
                    ? 'bg-hermes-500 text-white'
                    : 'bg-surface-800 text-surface-300 hover:bg-surface-700',
                ].join(' ')}
              >
                {filter === 'all' ? '全部' : filter === 'active' ? '活跃' : filter === 'done' ? '已完成' : '错误/取消'}
              </button>
            ))}
          </div>
          <input
            data-testid="background-tasks-search"
            type="text"
            placeholder="搜索任务标题..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-2 py-1 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 placeholder-surface-500 focus:outline-none focus:border-hermes-500"
          />
          <select
            data-testid="background-tasks-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="px-2 py-1 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200"
          >
            <option value="created">最新</option>
            <option value="duration">耗时</option>
            <option value="title">标题</option>
          </select>
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-xs text-surface-400">列数:</span>
            {[1, 2, 3, 4].map(c => (
              <button
                key={c}
                data-testid={`columns-${c}`}
                onClick={() => setColumns(c as 1 | 2 | 3 | 4)}
                className={[
                  'px-2 py-0.5 text-xs rounded',
                  columns === c
                    ? 'bg-hermes-500 text-white'
                    : 'bg-surface-800 text-surface-300',
                ].join(' ')}
              >
                {c}
              </button>
            ))}
            <button
              data-testid="background-tasks-clear"
              onClick={handleClearHistory}
              className="ml-2 px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
            >
              清空历史
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 opacity-30">📋</div>
              <p className="text-surface-400 text-sm">暂无任务</p>
              <p className="text-surface-500 text-xs mt-1">
                {statusFilter === 'active' ? '当前没有运行中的任务' : '创建任务后会显示在这里'}
              </p>
            </div>
          ) : (
            <div
              data-testid="background-tasks-grid"
              className="grid gap-3"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {filteredTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onPause={() => handlePause(task.id)}
                  onResume={() => handleResume(task.id)}
                  onCancel={() => setShowConfirm(task.id)}
                  onRetry={() => handleRetry(task.id)}
                  onClick={() => onTaskClick?.(task)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Confirm Dialog */}
        {showConfirm && (
          <div
            data-testid="cancel-confirm-dialog"
            className="absolute inset-0 bg-black/40 flex items-center justify-center"
            onClick={() => setShowConfirm(null)}
          >
            <div
              className="bg-surface-800 border border-surface-700 rounded p-4 max-w-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="text-sm text-surface-100 mb-3">确认取消该任务？</p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowConfirm(null)}
                  className="px-3 py-1 text-sm text-surface-300 hover:text-surface-100"
                >
                  取消
                </button>
                <button
                  data-testid="cancel-confirm-yes"
                  onClick={() => handleCancel(showConfirm)}
                  className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                >
                  确认
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: BackgroundTask;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onClick: () => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onPause, onResume, onCancel, onRetry, onClick }) => {
  const badge = STATUS_BADGE[task.status];
  const isActive = ['pending', 'queued', 'running', 'waiting', 'paused'].includes(task.status);
  const isRunning = task.status === 'running' || task.status === 'waiting';
  const isPaused = task.status === 'paused';
  const isFailed = task.status === 'error' || task.status === 'cancelled';

  return (
    <div
      data-testid={`task-card-${task.id}`}
      data-status={task.status}
      onClick={onClick}
      className="bg-surface-800/50 border border-surface-700 rounded p-3 hover:border-surface-600 transition-colors cursor-pointer"
    >
      <div className="flex items-start gap-2 mb-2">
        <span className="text-2xl leading-none">{TYPE_ICON[task.type]}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-surface-100 font-medium truncate">
            {task.title}
          </div>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs text-surface-400">{TYPE_NAME[task.type]}</span>
            <span className={['px-1.5 py-0.5 rounded text-xs', badge.className].join(' ')}>
              {badge.icon} {badge.label}
            </span>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {(isRunning || isPaused) && (
        <div className="mb-2">
          <div className="relative h-1 bg-surface-700 rounded overflow-hidden">
            <div
              className={[
                'h-full transition-all duration-300',
                isPaused ? 'bg-yellow-500' : 'bg-hermes-500',
              ].join(' ')}
              style={{ width: `${task.progress}%` }}
            />
          </div>
          <div className="text-xs text-surface-500 mt-1 text-right">
            {Math.round(task.progress)}%
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="flex items-center gap-2 text-xs text-surface-500 mb-2">
        {task.duration !== undefined && (
          <span>⏱ {formatDuration(task.duration)}</span>
        )}
        {task.error && (
          <span className="text-red-400 truncate" title={task.error.message}>
            ✗ {task.error.message}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-1">
        {isRunning && (
          <button
            data-testid={`task-pause-${task.id}`}
            onClick={(e) => { e.stopPropagation(); onPause(); }}
            className="flex-1 px-2 py-1 text-xs bg-yellow-500/20 text-yellow-300 rounded hover:bg-yellow-500/30"
          >
            ⏸ 暂停
          </button>
        )}
        {isPaused && (
          <button
            data-testid={`task-resume-${task.id}`}
            onClick={(e) => { e.stopPropagation(); onResume(); }}
            className="flex-1 px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30"
          >
            ▶ 继续
          </button>
        )}
        {isActive && (
          <button
            data-testid={`task-cancel-${task.id}`}
            onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="flex-1 px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
          >
            ⊘ 取消
          </button>
        )}
        {isFailed && (
          <button
            data-testid={`task-retry-${task.id}`}
            onClick={(e) => { e.stopPropagation(); onRetry(); }}
            className="flex-1 px-2 py-1 text-xs bg-hermes-500/20 text-hermes-300 rounded hover:bg-hermes-500/30"
          >
            ↻ 重试
          </button>
        )}
      </div>
    </div>
  );
};

export default BackgroundTasksPanel;
