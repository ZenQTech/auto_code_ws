/**
 * # ============================================================
 * # CommitTimeline 提交时间线组件（v6.40.0 P2-6）
 * # ============================================================
 * # 核心作用：以时间线形式展示 git commit 记录
 * #           与 VersionTimeline 风格保持一致
 * # 运行流程：
 * #   1. 接收 commits 列表
 * #   2. 按时间倒序展示
 * #   3. 每条 commit 显示：hash / author / date / message / 自动/手动标记
 * #   4. 点击 commit 可触发 onCommitClick 回调
 * # 输入参数：见 CommitTimelineProps
 * # 输出结果：时间线 UI DOM
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-6 新建
 * # ============================================================
 */

import { memo } from 'react';
import type { CommitEntry } from '../hooks/useCommitHistory';

export interface CommitTimelineProps {
  /** 提交列表（最新在上） */
  commits: CommitEntry[];
  /** 是否加载中 */
  loading?: boolean;
  /** 点击单条 commit */
  onCommitClick?: (commit: CommitEntry) => void;
  /** 最大显示条数（默认 20） */
  maxVisible?: number;
  /** 是否显示空状态（默认 true） */
  showEmptyState?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 测试 ID */
  'data-testid'?: string;
}

/**
 * 格式化日期
 * - 今天：HH:mm
 * - 昨天：昨天 HH:mm
 * - 7 天内：周X HH:mm
 * - 更早：YYYY-MM-DD
 */
function formatCommitDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `今天 ${date.toTimeString().slice(0, 5)}`;
    }
    if (diffDays === 1) {
      return `昨天 ${date.toTimeString().slice(0, 5)}`;
    }
    if (diffDays < 7) {
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return `${weekdays[date.getDay()]} ${date.toTimeString().slice(0, 5)}`;
    }
    return date.toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

/**
 * 获取 hash 短码（前 7 位）
 */
function shortHash(hash: string): string {
  return hash.length > 7 ? hash.slice(0, 7) : hash;
}

/**
 * 解析 commit message（首行为标题，剩余为详情）
 */
function parseCommitMessage(message: string): { title: string; body: string } {
  const lines = message.split('\n');
  return {
    title: lines[0] || '(无标题)',
    body: lines.slice(1).join('\n').trim(),
  };
}

interface CommitRowProps {
  commit: CommitEntry;
  isFirst: boolean;
  isLast: boolean;
  onClick?: (commit: CommitEntry) => void;
}

const CommitRow = memo(function CommitRow({
  commit,
  isFirst,
  isLast,
  onClick,
}: CommitRowProps) {
  const { title, body } = parseCommitMessage(commit.message);

  return (
    <div
      data-testid="commit-row"
      data-hash={commit.hash}
      data-auto-commit={commit.is_auto_commit}
      className="relative flex gap-3 pb-4"
    >
      {/* 时间线竖线 + 圆点 */}
      <div className="relative flex flex-col items-center" aria-hidden="true">
        {!isFirst && (
          <div className="absolute top-0 bottom-1/2 w-px bg-surface-300/40" />
        )}
        {!isLast && (
          <div className="absolute top-1/2 bottom-0 w-px bg-surface-300/40" />
        )}
        <div
          className={[
            'relative z-10',
            'w-3 h-3 mt-1',
            'rounded-full',
            'border-2',
            commit.is_auto_commit
              ? 'border-hermes-500 bg-hermes-500/20'
              : 'border-blue-500 bg-blue-500/20',
          ].join(' ')}
        />
      </div>

      {/* 内容 */}
      <div
        data-testid="commit-row-content"
        onClick={onClick ? () => onClick(commit) : undefined}
        className={[
          'flex-1 min-w-0',
          onClick ? 'cursor-pointer hover:bg-surface-100/50 rounded-md p-2 -m-2 transition-colors' : '',
        ].filter(Boolean).join(' ')}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
        onKeyDown={onClick ? (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick(commit);
          }
        } : undefined}
      >
        {/* 标题行 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4
                data-testid="commit-row-title"
                className="text-sm font-medium text-surface-900 truncate"
              >
                {title}
              </h4>
              {commit.is_auto_commit && (
                <span
                  data-testid="commit-row-auto-badge"
                  className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-hermes-500/15 text-hermes-600 tracking-wider"
                >
                  AUTO
                </span>
              )}
            </div>
            {body && (
              <p
                data-testid="commit-row-body"
                className="text-xs text-surface-600 mt-1 line-clamp-2 whitespace-pre-wrap"
              >
                {body}
              </p>
            )}
          </div>
        </div>

        {/* 元信息行 */}
        <div className="flex items-center gap-3 mt-1.5 text-xs text-surface-500">
          <code
            data-testid="commit-row-hash"
            className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-surface-200/50 text-surface-700"
          >
            {shortHash(commit.hash)}
          </code>
          <span data-testid="commit-row-author">@{commit.author}</span>
          <span data-testid="commit-row-date">{formatCommitDate(commit.date)}</span>
        </div>
      </div>
    </div>
  );
});

/**
 * CommitTimeline 提交时间线
 */
export const CommitTimeline = memo(function CommitTimeline({
  commits,
  loading = false,
  onCommitClick,
  maxVisible = 20,
  showEmptyState = true,
  className = '',
  'data-testid': dataTestId = 'commit-timeline',
}: CommitTimelineProps) {
  const visibleCommits = commits.slice(0, maxVisible);
  const hiddenCount = commits.length - visibleCommits.length;

  return (
    <div
      data-testid={dataTestId}
      data-component="commit-timeline"
      data-loading={loading}
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
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          提交历史
          <span
            data-testid="commit-timeline-count"
            className="text-xs font-normal text-surface-500 ml-1"
          >
            ({commits.length})
          </span>
        </h3>
        {loading && (
          <span
            data-testid="commit-timeline-loading"
            className="text-xs text-surface-500 flex items-center gap-1"
          >
            <span className="w-2 h-2 rounded-full bg-hermes-500 animate-pulse" />
            加载中
          </span>
        )}
      </div>

      {/* 列表 */}
      {visibleCommits.length === 0 ? (
        showEmptyState && !loading ? (
          <div
            data-testid="commit-timeline-empty"
            className="empty-state py-8"
          >
            <span className="empty-icon">
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </span>
            <p className="text-sm text-surface-500">暂无提交记录</p>
          </div>
        ) : null
      ) : (
        <div
          data-testid="commit-timeline-list"
          className="space-y-0"
        >
          {visibleCommits.map((commit, idx) => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              isFirst={idx === 0}
              isLast={idx === visibleCommits.length - 1}
              onClick={onCommitClick}
            />
          ))}
          {hiddenCount > 0 && (
            <div
              data-testid="commit-timeline-more"
              className="text-xs text-surface-500 text-center pt-2"
            >
              还有 {hiddenCount} 条更早的提交...
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default CommitTimeline;
