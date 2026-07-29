/**
 * # ============================================================
 * CommitTimeline 单元测试（v1.0.0 P2-6）
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CommitTimeline } from './CommitTimeline';
import type { CommitEntry } from '../hooks/useCommitHistory';

const sampleCommits: CommitEntry[] = [
  { hash: 'abc1234567', author: 'alice', date: '2026-07-29T10:00:00Z', message: 'feat: add new feature', is_auto_commit: false },
  { hash: 'def5678901', author: 'bob', date: '2026-07-28T15:30:00Z', message: 'fix: resolve bug', is_auto_commit: true },
  { hash: 'ghi9012345', author: 'carol', date: '2026-07-27T09:15:00Z', message: 'docs: update README', is_auto_commit: false },
];

describe('CommitTimeline', () => {
  it('默认渲染 commit 列表', () => {
    render(<CommitTimeline commits={sampleCommits} />);
    expect(screen.getByTestId('commit-timeline')).toBeTruthy();
    expect(screen.getAllByTestId('commit-row')).toHaveLength(3);
  });

  it('空状态显示提示', () => {
    render(<CommitTimeline commits={[]} />);
    expect(screen.getByTestId('commit-timeline-empty')).toBeTruthy();
    expect(screen.getByText('暂无提交记录')).toBeTruthy();
  });

  it('showEmptyState=false 不显示空状态', () => {
    render(<CommitTimeline commits={[]} showEmptyState={false} />);
    expect(screen.queryByTestId('commit-timeline-empty')).toBeNull();
  });

  it('count 显示总数', () => {
    render(<CommitTimeline commits={sampleCommits} />);
    expect(screen.getByTestId('commit-timeline-count').textContent).toBe('(3)');
  });

  it('自动提交显示 AUTO 标签', () => {
    render(<CommitTimeline commits={sampleCommits} />);
    const autoBadges = screen.getAllByTestId('commit-row-auto-badge');
    expect(autoBadges).toHaveLength(1);
    expect(autoBadges[0].textContent).toBe('AUTO');
  });

  it('手动提交不显示 AUTO 标签', () => {
    const onlyManual: CommitEntry[] = [
      { hash: 'abc1234', author: 'alice', date: '2026-07-29T10:00:00Z', message: 'feat: manual', is_auto_commit: false },
    ];
    render(<CommitTimeline commits={onlyManual} />);
    expect(screen.queryByTestId('commit-row-auto-badge')).toBeNull();
  });

  it('显示 hash 短码（前 7 位）', () => {
    render(<CommitTimeline commits={sampleCommits} />);
    const hashes = screen.getAllByTestId('commit-row-hash');
    expect(hashes[0].textContent).toBe('abc1234');
  });

  it('显示作者和日期', () => {
    render(<CommitTimeline commits={sampleCommits} />);
    const authors = screen.getAllByTestId('commit-row-author');
    expect(authors[0].textContent).toBe('@alice');
  });

  it('commit message 解析为 title + body', () => {
    const commitWithBody: CommitEntry[] = [
      {
        hash: 'abc1234',
        author: 'alice',
        date: '2026-07-29T10:00:00Z',
        message: 'feat: add feature\n\nThis is the body\nwith multiple lines',
        is_auto_commit: false,
      },
    ];
    render(<CommitTimeline commits={commitWithBody} />);
    expect(screen.getByTestId('commit-row-title').textContent).toBe('feat: add feature');
    expect(screen.getByTestId('commit-row-body').textContent).toBe(
      'This is the body\nwith multiple lines'
    );
  });

  it('点击 commit 触发 onCommitClick', () => {
    const onClick = vi.fn();
    render(<CommitTimeline commits={sampleCommits} onCommitClick={onClick} />);
    const content = screen.getAllByTestId('commit-row-content')[0];
    fireEvent.click(content);
    expect(onClick).toHaveBeenCalledWith(sampleCommits[0]);
  });

  it('无 onCommitClick 时内容不可点击', () => {
    render(<CommitTimeline commits={sampleCommits} />);
    const content = screen.getAllByTestId('commit-row-content')[0];
    expect(content.getAttribute('role')).toBeNull();
  });

  it('maxVisible 限制显示条数', () => {
    render(<CommitTimeline commits={sampleCommits} maxVisible={2} />);
    expect(screen.getAllByTestId('commit-row')).toHaveLength(2);
    expect(screen.getByTestId('commit-timeline-more')).toBeTruthy();
  });

  it('data-loading 属性生效', () => {
    render(<CommitTimeline commits={sampleCommits} loading />);
    expect(screen.getByTestId('commit-timeline').getAttribute('data-loading')).toBe('true');
    expect(screen.getByTestId('commit-timeline-loading')).toBeTruthy();
  });

  it('data-hash 与 data-auto-commit 属性生效', () => {
    render(<CommitTimeline commits={sampleCommits} />);
    const rows = screen.getAllByTestId('commit-row');
    expect(rows[0].getAttribute('data-hash')).toBe('abc1234567');
    expect(rows[0].getAttribute('data-auto-commit')).toBe('false');
    expect(rows[1].getAttribute('data-auto-commit')).toBe('true');
  });
});
