/**
 * # ============================================================
 * # UnifiedTimeline 统一时间线（v6.40.0 P2-6）
 * # ============================================================
 * # 核心作用：聚合展示 UndoRedoStack 撤销栈 + Git Commit 历史
 * #           提供"本地编辑历史" + "项目提交历史"统一视图
 * # 运行流程：
 * #   1. 接收 commits + undoRedoEntries 两种数据源
 * #   2. 按时间戳合并排序
 * #   3. 区分显示 local-edit（撤销栈）vs git-commit（提交）
 * #   4. 支持点击单条触发回调
 * # 输入参数：见 UnifiedTimelineProps
 * # 输出结果：合并时间线 UI DOM
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-6 新建
 * # ============================================================
 */

import { useMemo, memo } from 'react';
import type { UndoRedoEntry } from '../utils/undoRedoStack';
import type { CommitEntry } from '../hooks/useCommitHistory';

export type TimelineItemType = 'local-edit' | 'git-commit' | 'auto-commit' | 'milestone';

export interface UnifiedTimelineItem {
  id: string;
  type: TimelineItemType;
  title: string;
  body?: string;
  timestamp: number;
  author?: string;
  hash?: string;
  raw: UndoRedoEntry<unknown> | CommitEntry;
}

export interface UnifiedTimelineProps {
  /** 撤销栈条目（最新在上） */
  undoRedoEntries?: UndoRedoEntry<unknown>[];
  /** 提交历史（最新在上） */
  commits?: CommitEntry[];
  /** 点击单条 */
  onItemClick?: (item: UnifiedTimelineItem) => void;
  /** 最大显示条数（默认 30） */
  maxVisible?: number;
  /** 是否显示空状态 */
  showEmptyState?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 测试 ID */
  'data-testid'?: string;
}

/** 类型 → 颜色 class */
const TYPE_COLOR: Record<TimelineItemType, string> = {
  'local-edit': 'border-blue-500 bg-blue-500/20',
  'git-commit': 'border-purple-500 bg-purple-500/20',
  'auto-commit': 'border-hermes-500 bg-hermes-500/20',
  'milestone': 'border-green-500 bg-green-500/20',
};

/** 类型 → 中文标签 */
const TYPE_LABEL: Record<TimelineItemType, string> = {
  'local-edit': '本地编辑',
  'git-commit': '代码提交',
  'auto-commit': '自动提交',
  'milestone': '里程碑',
};

/**
 * 格式化时间戳
 */
function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const time = date.toTimeString().slice(0, 5);

  if (diffDays === 0) return `今天 ${time}`;
  if (diffDays === 1) return `昨天 ${time}`;
  if (diffDays < 7) {
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return `${weekdays[date.getDay()]} ${time}`;
  }
  return date.toISOString().slice(0, 10);
}

interface UnifiedItemRowProps {
  item: UnifiedTimelineItem;
  isFirst: boolean;
  isLast: boolean;
  onClick?: (item: UnifiedTimelineItem) => void;
}

const UnifiedItemRow = memo(function UnifiedItemRow({
  item,
  isFirst,
  isLast,
  onClick,
}: UnifiedItemRowProps) {
  return (
    <div
      data-testid="unified-item-row"
      data-type={item.type}
      data-id={item.id}
      className="relative flex gap-3 pb-4"
    >
      {/* 时间线 */}
      <div className="relative flex flex-col items-center" aria-hidden="true">
        {!isFirst && <div className="absolute top-0 bottom-1/2 w-px bg-surface-300/40" />}
        {!isLast && <div className="absolute top-1/2 bottom-0 w-px bg-surface-300/40" />}
        <div
          className={[
            'relative z-10',
            'w-3 h-3 mt-1',
            'rounded-full',
            'border-2',
            TYPE_COLOR[item.type],
          ].join(' ')}
        />
      </div>

      {/* 内容 */}
      <div
        data-testid="unified-item-content"
        onClick={onClick ? () => onClick(item) : undefined}
        className={[
          'flex-1 min-w-0',
          onClick ? 'cursor-pointer hover:bg-surface-100/50 rounded-md p-2 -m-2 transition-colors' : '',
        ].filter(Boolean).join(' ')}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(item);
          }
        } : undefined}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4
                data-testid="unified-item-title"
                className="text-sm font-medium text-surface-900 truncate"
              >
                {item.title}
              </h4>
              <span
                data-testid="unified-item-type-badge"
                className={[
                  'text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded tracking-wider',
                  item.type === 'auto-commit' ? 'bg-hermes-500/15 text-hermes-600' :
                  item.type === 'git-commit' ? 'bg-purple-500/15 text-purple-600' :
                  item.type === 'milestone' ? 'bg-green-500/15 text-green-600' :
                  'bg-blue-500/15 text-blue-600',
                ].join(' ')}
              >
                {TYPE_LABEL[item.type]}
              </span>
            </div>
            {item.body && (
              <p
                data-testid="unified-item-body"
                className="text-xs text-surface-600 mt-1 line-clamp-2"
              >
                {item.body}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 mt-1.5 text-xs text-surface-500">
          {item.hash && (
            <code
              data-testid="unified-item-hash"
              className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface-200/50 text-surface-700"
            >
              {item.hash.length > 7 ? item.hash.slice(0, 7) : item.hash}
            </code>
          )}
          {item.author && (
            <span data-testid="unified-item-author">@{item.author}</span>
          )}
          <span data-testid="unified-item-timestamp">{formatTimestamp(item.timestamp)}</span>
        </div>
      </div>
    </div>
  );
});

/**
 * UnifiedTimeline 统一时间线
 */
export const UnifiedTimeline = memo(function UnifiedTimeline({
  undoRedoEntries = [],
  commits = [],
  onItemClick,
  maxVisible = 30,
  showEmptyState = true,
  className = '',
  'data-testid': dataTestId = 'unified-timeline',
}: UnifiedTimelineProps) {
  // 合并并按时间倒序排序
  const items = useMemo<UnifiedTimelineItem[]>(() => {
    const all: UnifiedTimelineItem[] = [];

    // 撤销栈条目
    for (const entry of undoRedoEntries) {
      all.push({
        id: `undo_${entry.id}`,
        type: 'local-edit',
        title: entry.label,
        timestamp: entry.timestamp,
        raw: entry,
      });
    }

    // 提交历史
    for (const commit of commits) {
      all.push({
        id: `commit_${commit.hash}`,
        type: commit.is_auto_commit ? 'auto-commit' : 'git-commit',
        title: (commit.message || '').split('\n')[0] || '(无标题)',
        body: (commit.message || '').split('\n').slice(1).join('\n').trim() || undefined,
        timestamp: new Date(commit.date).getTime(),
        author: commit.author,
        hash: commit.hash,
        raw: commit,
      });
    }

    // 按时间倒序
    all.sort((a, b) => b.timestamp - a.timestamp);
    return all;
  }, [undoRedoEntries, commits]);

  const visibleItems = items.slice(0, maxVisible);
  const hiddenCount = items.length - visibleItems.length;

  // 统计
  const stats = useMemo(() => {
    return {
      local: items.filter((i) => i.type === 'local-edit').length,
      git: items.filter((i) => i.type === 'git-commit' || i.type === 'auto-commit').length,
      total: items.length,
    };
  }, [items]);

  return (
    <div
      data-testid={dataTestId}
      data-component="unified-timeline"
      className={['relative', className].filter(Boolean).join(' ')}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-surface-200/60">
        <h3 className="text-sm font-semibold text-surface-900 flex items-center gap-2">
          <svg
            className="w-4 h-4 text-hermes-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
            />
          </svg>
          统一时间线
          <span
            data-testid="unified-timeline-count"
            className="text-xs font-normal text-surface-500 ml-1"
          >
            ({stats.total})
          </span>
        </h3>
        <div
          data-testid="unified-timeline-stats"
          className="flex items-center gap-3 text-xs text-surface-500"
        >
          <span data-testid="unified-timeline-stats-local">本地: {stats.local}</span>
          <span data-testid="unified-timeline-stats-git">提交: {stats.git}</span>
        </div>
      </div>

      {/* 列表 */}
      {visibleItems.length === 0 ? (
        showEmptyState ? (
          <div
            data-testid="unified-timeline-empty"
            className="empty-state py-8"
          >
            <span className="empty-icon">📭</span>
            <p className="text-sm text-surface-500">暂无历史记录</p>
          </div>
        ) : null
      ) : (
        <div data-testid="unified-timeline-list">
          {visibleItems.map((item, idx) => (
            <UnifiedItemRow
              key={item.id}
              item={item}
              isFirst={idx === 0}
              isLast={idx === visibleItems.length - 1}
              onClick={onItemClick}
            />
          ))}
          {hiddenCount > 0 && (
            <div
              data-testid="unified-timeline-more"
              className="text-xs text-surface-500 text-center pt-2"
            >
              还有 {hiddenCount} 条更早的记录...
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default UnifiedTimeline;
