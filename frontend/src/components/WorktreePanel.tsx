/**
 * # ============================================================
 * # WorktreePanel - Git Worktree 隔离管理面板 (v1.0.0 Cycle 20 G20-01)
 * # ============================================================
 * # 核心作用：展示所有 worktree，支持创建 / 合并 / 丢弃 / diff / cleanup
 * # 运行流程：
 * #   1. 通过 getWorktreeManager() 单例订阅
 * #   2. 展示 worktree 卡片（type / status / branch / changes）
 * #   3. 支持操作：merge / discard / diff / cleanup
 * #   4. 完成时弹 toast 通知
 * # 输入参数：isOpen / onClose
 * # 输出结果：JSX
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 20 G20-01 初次创建
 * # ============================================================
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  getWorktreeManager,
  type WorktreeInfo,
  type WorktreeStatus,
  type WorktreeType,
  type WorktreeEvent,
} from '../utils/worktreeManager';

export interface WorktreePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type StatusFilter = 'all' | 'active' | 'merged' | 'discarded';
type ViewMode = 'grid' | 'list';

const STATUS_BADGE: Record<WorktreeStatus, { label: string; className: string; icon: string }> = {
  creating: { label: '创建中', className: 'bg-slate-500/20 text-slate-300', icon: '⏳' },
  ready: { label: '就绪', className: 'bg-blue-500/20 text-blue-300', icon: '✓' },
  'in-use': { label: '使用中', className: 'bg-yellow-500/20 text-yellow-300', icon: '⚡' },
  modified: { label: '已修改', className: 'bg-orange-500/20 text-orange-300', icon: '✎' },
  merged: { label: '已合并', className: 'bg-green-500/20 text-green-300', icon: '✓✓' },
  discarded: { label: '已丢弃', className: 'bg-slate-500/20 text-slate-400', icon: '⊘' },
  error: { label: '错误', className: 'bg-red-500/20 text-red-300', icon: '✗' },
};

const TYPE_ICON: Record<WorktreeType, string> = {
  local: '🏠',
  isolated: '🔒',
  review: '🔍',
  experiment: '🧪',
};

const TYPE_NAME: Record<WorktreeType, string> = {
  local: '本地',
  isolated: '隔离',
  review: '审查',
  experiment: '实验',
};

function formatAge(ts: number): string {
  const age = Date.now() - ts;
  if (age < 60000) return `${Math.floor(age / 1000)}s 前`;
  if (age < 3600000) return `${Math.floor(age / 60000)}m 前`;
  if (age < 86400000) return `${Math.floor(age / 3600000)}h 前`;
  return `${Math.floor(age / 86400000)}d 前`;
}

export function WorktreePanel({ isOpen, onClose }: WorktreePanelProps) {
  const manager = useMemo(() => getWorktreeManager(), []);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<WorktreeType | 'all'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [diffPreview, setDiffPreview] = useState<{ id: string; content: string } | null>(null);

  // 订阅 worktree 变化
  useEffect(() => {
    if (!isOpen) return;
    const refresh = () => {
      setWorktrees(manager.list());
    };
    refresh();
    const unsub = (event: WorktreeEvent) => {
      refresh();
      // 触发事件时记录到控制台，便于调试
      // eslint-disable-next-line no-console
      console.debug('[WorktreePanel] event:', event.type);
    };
    const off = manager.subscribe(unsub);
    return () => {
      off();
    };
  }, [manager, isOpen]);

  // 过滤
  const filtered = useMemo(() => {
    let result = [...worktrees];
    if (statusFilter === 'active') {
      result = result.filter((w) => ['creating', 'ready', 'in-use', 'modified'].includes(w.status));
    } else if (statusFilter === 'merged') {
      result = result.filter((w) => w.status === 'merged');
    } else if (statusFilter === 'discarded') {
      result = result.filter((w) => w.status === 'discarded' || w.status === 'error');
    }
    if (typeFilter !== 'all') {
      result = result.filter((w) => w.type === typeFilter);
    }
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }, [worktrees, statusFilter, typeFilter]);

  const stats = useMemo(() => {
    return {
      total: worktrees.length,
      active: worktrees.filter((w) =>
        ['creating', 'ready', 'in-use', 'modified'].includes(w.status),
      ).length,
      merged: worktrees.filter((w) => w.status === 'merged').length,
      discarded: worktrees.filter((w) => w.status === 'discarded' || w.status === 'error').length,
    };
  }, [worktrees]);

  const handleCreate = useCallback(
    async (type: WorktreeType) => {
      try {
        await manager.create({ type, label: `${TYPE_NAME[type]} ${stats.total + 1}` });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err);
      }
    },
    [manager, stats.total],
  );

  const handleMerge = useCallback(
    async (id: string) => {
      try {
        const result = await manager.merge(id);
        if (!result.success) {
          // eslint-disable-next-line no-console
          console.warn('合并失败:', result.message);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err);
      }
    },
    [manager],
  );

  const handleDiscard = useCallback(
    async (id: string) => {
      try {
        await manager.discard(id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err);
      }
    },
    [manager],
  );

  const handleDiff = useCallback(
    async (id: string) => {
      try {
        const result = await manager.diff(id);
        const content = result.files
          .map(
            (f) =>
              `# ${f.path} (${f.status})\n+${f.additions} -${f.deletions}\n${f.hunks.map((h) => h.content).join('\n')}`,
          )
          .join('\n\n');
        setDiffPreview({ id, content: content || '(无变更)' });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(err);
      }
    },
    [manager],
  );

  const handleCleanup = useCallback(async () => {
    try {
      const removed = await manager.cleanup();
      // eslint-disable-next-line no-console
      console.log(`清理了 ${removed} 个过期 worktree`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(err);
    }
  }, [manager]);

  // Esc 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !diffPreview) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Escape' && diffPreview) {
        setDiffPreview(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose, diffPreview]);

  if (!isOpen) return null;

  return (
    <div
      data-testid="worktree-panel"
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gradient-to-br from-surface-900 to-surface-950 border border-surface-700 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col animate-in fade-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700">
          <div>
            <h2 className="text-lg font-semibold text-surface-50">Worktree 隔离</h2>
            <p className="text-xs text-surface-400 mt-1">
              活跃 {stats.active} 个 · 总计 {stats.total} · 已合并 {stats.merged} · 已丢弃 {stats.discarded}
            </p>
          </div>
          <button
            data-testid="worktree-close"
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
            {(['all', 'active', 'merged', 'discarded'] as StatusFilter[]).map((filter) => (
              <button
                key={filter}
                data-testid={`worktree-status-${filter}`}
                onClick={() => setStatusFilter(filter)}
                className={[
                  'px-2 py-1 text-xs rounded',
                  statusFilter === filter
                    ? 'bg-hermes-500 text-white'
                    : 'bg-surface-800 text-surface-300 hover:bg-surface-700',
                ].join(' ')}
              >
                {filter === 'all'
                  ? '全部'
                  : filter === 'active'
                    ? '活跃'
                    : filter === 'merged'
                      ? '已合并'
                      : '已丢弃'}
              </button>
            ))}
          </div>
          <select
            data-testid="worktree-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as WorktreeType | 'all')}
            className="px-2 py-1 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200"
          >
            <option value="all">所有类型</option>
            <option value="local">本地</option>
            <option value="isolated">隔离</option>
            <option value="review">审查</option>
            <option value="experiment">实验</option>
          </select>
          <div className="flex items-center gap-1">
            <span className="text-xs text-surface-400">视图:</span>
            {(['grid', 'list'] as ViewMode[]).map((m) => (
              <button
                key={m}
                data-testid={`worktree-view-${m}`}
                onClick={() => setViewMode(m)}
                className={[
                  'px-2 py-0.5 text-xs rounded',
                  viewMode === m
                    ? 'bg-hermes-500 text-white'
                    : 'bg-surface-800 text-surface-300',
                ].join(' ')}
              >
                {m === 'grid' ? '网格' : '列表'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <button
              data-testid="worktree-create-isolated"
              onClick={() => handleCreate('isolated')}
              className="px-2 py-1 text-xs bg-hermes-500 text-white rounded hover:bg-hermes-600"
            >
              + 隔离
            </button>
            <button
              data-testid="worktree-create-review"
              onClick={() => handleCreate('review')}
              className="px-2 py-1 text-xs bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30"
            >
              + 审查
            </button>
            <button
              data-testid="worktree-create-experiment"
              onClick={() => handleCreate('experiment')}
              className="px-2 py-1 text-xs bg-purple-500/20 text-purple-300 rounded hover:bg-purple-500/30"
            >
              + 实验
            </button>
            <button
              data-testid="worktree-cleanup"
              onClick={handleCleanup}
              className="ml-2 px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
            >
              清理过期
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-4xl mb-3 opacity-30">🌳</div>
              <p className="text-surface-400 text-sm">暂无 worktree</p>
              <p className="text-surface-500 text-xs mt-1">
                点击上方按钮创建隔离 / 审查 / 实验 worktree
              </p>
            </div>
          ) : viewMode === 'grid' ? (
            <div
              data-testid="worktree-grid"
              className="grid grid-cols-2 gap-3"
            >
              {filtered.map((wt) => (
                <WorktreeCard
                  key={wt.id}
                  worktree={wt}
                  onMerge={handleMerge}
                  onDiscard={handleDiscard}
                  onDiff={handleDiff}
                />
              ))}
            </div>
          ) : (
            <div data-testid="worktree-list" className="space-y-2">
              {filtered.map((wt) => (
                <WorktreeRow
                  key={wt.id}
                  worktree={wt}
                  onMerge={handleMerge}
                  onDiscard={handleDiscard}
                  onDiff={handleDiff}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Diff Preview Modal */}
      {diffPreview && (
        <div
          data-testid="worktree-diff-modal"
          className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setDiffPreview(null)}
        >
          <div className="bg-surface-900 border border-surface-700 rounded-lg shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-surface-700">
              <h3 className="text-sm font-semibold text-surface-50">Diff: {diffPreview.id}</h3>
              <button
                data-testid="worktree-diff-close"
                onClick={() => setDiffPreview(null)}
                className="text-surface-400 hover:text-surface-100 px-2"
              >
                ✕
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs text-surface-300 font-mono whitespace-pre-wrap">
              {diffPreview.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// 卡片组件
interface WorktreeCardProps {
  worktree: WorktreeInfo;
  onMerge: (id: string) => void;
  onDiscard: (id: string) => void;
  onDiff: (id: string) => void;
}

function WorktreeCard({ worktree, onMerge, onDiscard, onDiff }: WorktreeCardProps) {
  const badge = STATUS_BADGE[worktree.status];
  const isActive = ['creating', 'ready', 'in-use', 'modified'].includes(worktree.status);
  return (
    <div
      data-testid={`worktree-card-${worktree.id}`}
      className="bg-surface-800/50 border border-surface-700 rounded p-3 hover:border-hermes-500/50 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-base">{TYPE_ICON[worktree.type]}</span>
            <span className="text-sm font-medium text-surface-100 truncate">
              {worktree.label || worktree.id.slice(0, 8)}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.className}`}>
              {badge.icon} {badge.label}
            </span>
          </div>
          <div className="mt-2 text-xs text-surface-400 space-y-1">
            <div>
              <span className="text-surface-500">分支:</span> <code className="text-surface-200">{worktree.branch}</code>
            </div>
            <div>
              <span className="text-surface-500">基础:</span> <code className="text-surface-200">{worktree.baseBranch}</code>
            </div>
            <div>
              <span className="text-surface-500">变更:</span>{' '}
              <span className="text-green-300">+{worktree.changes?.added ?? 0}</span>{' '}
              <span className="text-yellow-300">~{worktree.changes?.modified ?? 0}</span>{' '}
              <span className="text-red-300">-{worktree.changes?.deleted ?? 0}</span>
            </div>
            <div>
              <span className="text-surface-500">创建:</span> {formatAge(worktree.createdAt)}
            </div>
          </div>
        </div>
      </div>
      {isActive && (
        <div className="flex items-center gap-1 mt-3 pt-3 border-t border-surface-700">
          <button
            data-testid={`worktree-diff-${worktree.id}`}
            onClick={() => onDiff(worktree.id)}
            className="flex-1 px-2 py-1 text-xs bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30"
          >
            Diff
          </button>
          <button
            data-testid={`worktree-merge-${worktree.id}`}
            onClick={() => onMerge(worktree.id)}
            className="flex-1 px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded hover:bg-green-500/30"
          >
            合并
          </button>
          <button
            data-testid={`worktree-discard-${worktree.id}`}
            onClick={() => onDiscard(worktree.id)}
            className="flex-1 px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded hover:bg-red-500/30"
          >
            丢弃
          </button>
        </div>
      )}
    </div>
  );
}

// 列表行组件
function WorktreeRow({ worktree, onMerge, onDiscard, onDiff }: WorktreeCardProps) {
  const badge = STATUS_BADGE[worktree.status];
  const isActive = ['creating', 'ready', 'in-use', 'modified'].includes(worktree.status);
  return (
    <div
      data-testid={`worktree-row-${worktree.id}`}
      className="flex items-center gap-3 bg-surface-800/50 border border-surface-700 rounded px-3 py-2 hover:border-hermes-500/50 transition-colors"
    >
      <span className="text-base">{TYPE_ICON[worktree.type]}</span>
      <span className="text-sm font-medium text-surface-100 min-w-32 truncate">
        {worktree.label || worktree.id.slice(0, 8)}
      </span>
      <code className="text-xs text-surface-300 font-mono min-w-40">{worktree.branch}</code>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${badge.className}`}>
        {badge.icon} {badge.label}
      </span>
      <div className="flex-1 text-xs text-surface-500">
        +{worktree.changes?.added ?? 0} / ~{worktree.changes?.modified ?? 0} / -
        {worktree.changes?.deleted ?? 0}
      </div>
      <div className="text-xs text-surface-500">{formatAge(worktree.createdAt)}</div>
      {isActive && (
        <div className="flex items-center gap-1">
          <button
            data-testid={`worktree-row-diff-${worktree.id}`}
            onClick={() => onDiff(worktree.id)}
            className="px-2 py-0.5 text-xs bg-blue-500/20 text-blue-300 rounded"
          >
            Diff
          </button>
          <button
            data-testid={`worktree-row-merge-${worktree.id}`}
            onClick={() => onMerge(worktree.id)}
            className="px-2 py-0.5 text-xs bg-green-500/20 text-green-300 rounded"
          >
            合并
          </button>
          <button
            data-testid={`worktree-row-discard-${worktree.id}`}
            onClick={() => onDiscard(worktree.id)}
            className="px-2 py-0.5 text-xs bg-red-500/20 text-red-300 rounded"
          >
            丢弃
          </button>
        </div>
      )}
    </div>
  );
}

export default WorktreePanel;
