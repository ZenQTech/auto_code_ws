/**
 * # ============================================================
 * UnifiedTimeline 单元测试（v1.0.0 P2-6）
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UnifiedTimeline } from './UnifiedTimeline';
import type { CommitEntry } from '../hooks/useCommitHistory';
import type { UndoRedoEntry } from '../utils/undoRedoStack';

const now = Date.now();
const hour = 60 * 60 * 1000;

const sampleCommits: CommitEntry[] = [
  { hash: 'abc1234', author: 'alice', date: new Date(now - hour).toISOString(), message: 'feat: commit', is_auto_commit: false },
  { hash: 'def5678', author: 'bot', date: new Date(now - 2 * hour).toISOString(), message: 'fix: auto fix', is_auto_commit: true },
];

const sampleUndoEntries: UndoRedoEntry<unknown>[] = [
  { id: 'e1', state: {}, label: '输入文字', timestamp: now - 0.5 * hour },
  { id: 'e2', state: {}, label: '删除段落', timestamp: now - 1.5 * hour },
];

describe('UnifiedTimeline', () => {
  it('默认渲染合并时间线', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={sampleUndoEntries}
      />
    );
    expect(screen.getByTestId('unified-timeline')).toBeTruthy();
    expect(screen.getAllByTestId('unified-item-row').length).toBe(4);
  });

  it('空状态显示提示', () => {
    render(<UnifiedTimeline commits={[]} undoRedoEntries={[]} />);
    expect(screen.getByTestId('unified-timeline-empty')).toBeTruthy();
    expect(screen.getByText('暂无历史记录')).toBeTruthy();
  });

  it('showEmptyState=false 不显示空状态', () => {
    render(<UnifiedTimeline commits={[]} undoRedoEntries={[]} showEmptyState={false} />);
    expect(screen.queryByTestId('unified-timeline-empty')).toBeNull();
  });

  it('按时间戳倒序合并（最新在上）', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={sampleUndoEntries}
      />
    );
    const rows = screen.getAllByTestId('unified-item-row');
    // 0.5h前（local-edit）-> 1h前（git-commit）-> 1.5h前（local-edit）-> 2h前（auto-commit）
    expect(rows[0].getAttribute('data-type')).toBe('local-edit');
    expect(rows[1].getAttribute('data-type')).toBe('git-commit');
    expect(rows[2].getAttribute('data-type')).toBe('local-edit');
    expect(rows[3].getAttribute('data-type')).toBe('auto-commit');
  });

  it('自动 commit 显示为 auto-commit 类型', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={[]}
      />
    );
    const rows = screen.getAllByTestId('unified-item-row');
    expect(rows[0].getAttribute('data-type')).toBe('git-commit');
    expect(rows[1].getAttribute('data-type')).toBe('auto-commit');
  });

  it('type badge 标签正确', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={sampleUndoEntries}
      />
    );
    const badges = screen.getAllByTestId('unified-item-type-badge');
    const labels = badges.map((b) => b.textContent);
    expect(labels).toContain('本地编辑');
    expect(labels).toContain('代码提交');
    expect(labels).toContain('自动提交');
  });

  it('stats 显示本地和提交数量', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={sampleUndoEntries}
      />
    );
    expect(screen.getByTestId('unified-timeline-stats-local').textContent).toContain('2');
    expect(screen.getByTestId('unified-timeline-stats-git').textContent).toContain('2');
    expect(screen.getByTestId('unified-timeline-count').textContent).toBe('(4)');
  });

  it('点击 item 触发 onItemClick', () => {
    const onClick = vi.fn();
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={sampleUndoEntries}
        onItemClick={onClick}
      />
    );
    const content = screen.getAllByTestId('unified-item-content')[0];
    fireEvent.click(content);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('maxVisible 限制显示条数', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={sampleUndoEntries}
        maxVisible={2}
      />
    );
    expect(screen.getAllByTestId('unified-item-row')).toHaveLength(2);
    expect(screen.getByTestId('unified-timeline-more')).toBeTruthy();
  });

  it('git commit 显示 hash', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={[]}
      />
    );
    const hashes = screen.getAllByTestId('unified-item-hash');
    expect(hashes[0].textContent).toBe('abc1234');
  });

  it('local edit 不显示 hash', () => {
    render(
      <UnifiedTimeline
        commits={[]}
        undoRedoEntries={sampleUndoEntries}
      />
    );
    expect(screen.queryByTestId('unified-item-hash')).toBeNull();
  });

  it('显示作者', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={sampleUndoEntries}
      />
    );
    const authors = screen.getAllByTestId('unified-item-author');
    expect(authors.some((a) => a.textContent === '@alice')).toBe(true);
    expect(authors.some((a) => a.textContent === '@bot')).toBe(true);
  });

  it('data-id 唯一标识', () => {
    render(
      <UnifiedTimeline
        commits={sampleCommits}
        undoRedoEntries={sampleUndoEntries}
      />
    );
    const rows = screen.getAllByTestId('unified-item-row');
    const ids = rows.map((r) => r.getAttribute('data-id'));
    const unique = new Set(ids);
    expect(unique.size).toBe(4);
  });
});
