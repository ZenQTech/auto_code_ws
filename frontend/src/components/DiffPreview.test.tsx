/**
 * # ============================================================
 * # DiffPreview 单元测试
 * # Cycle 66 G66-02
 * # ====================================
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiffPreviewView } from './DiffPreview';

afterEach(() => {
  cleanup();
});

const MOCK_SNAPSHOT: any = {
  snapshot_id: 'snap-abc123',
  session_id: 's1',
  agent_id: 'a1',
  trigger: 'manual',
  description: 'test',
  files: [],
  file_count: 3,
  total_size: 100,
  created_at: 1000.0,
};

const MOCK_PREVIEW: any = {
  snapshot_id: 'snap-abc123',
  files: [
    {
      path: '/a.py',
      change_type: 'modify',
      diff: '@@ -1,3 +1,3 @@\n line1\n-old\n+new\n line3',
      additions: 1,
      deletions: 1,
    },
    {
      path: '/b.py',
      change_type: 'create',
      diff: '@@ -0,0 +1,2 @@\n+new line 1\n+new line 2',
      additions: 2,
      deletions: 0,
    },
    {
      path: '/c.py',
      change_type: 'delete',
      diff: '@@ -1,2 +0,0 @@\n-line 1\n-line 2',
      additions: 0,
      deletions: 2,
    },
  ],
  created_at: 1000,
};

describe('DiffPreviewView', () => {
  it('渲染预览', () => {
    render(
      <DiffPreviewView preview={MOCK_PREVIEW} snapshot={MOCK_SNAPSHOT} />
    );
    expect(screen.getByTestId('diff-preview')).toBeTruthy();
  });

  it('显示所有文件变更', () => {
    render(
      <DiffPreviewView preview={MOCK_PREVIEW} snapshot={MOCK_SNAPSHOT} />
    );
    const changes = screen.getAllByTestId('file-change');
    expect(changes.length).toBe(3);
  });

  it('显示变更类型', () => {
    render(
      <DiffPreviewView preview={MOCK_PREVIEW} snapshot={MOCK_SNAPSHOT} />
    );
    expect(screen.getByText('修改')).toBeTruthy();
    expect(screen.getByText('新增')).toBeTruthy();
    expect(screen.getByText('删除')).toBeTruthy();
  });

  it('显示增删统计', () => {
    render(
      <DiffPreviewView preview={MOCK_PREVIEW} snapshot={MOCK_SNAPSHOT} />
    );
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('-2')).toBeTruthy();
  });

  it('显示文件路径', () => {
    render(
      <DiffPreviewView preview={MOCK_PREVIEW} snapshot={MOCK_SNAPSHOT} />
    );
    expect(screen.getByText('/a.py')).toBeTruthy();
    expect(screen.getByText('/b.py')).toBeTruthy();
    expect(screen.getByText('/c.py')).toBeTruthy();
  });

  it('默认展开 diff', () => {
    render(
      <DiffPreviewView preview={MOCK_PREVIEW} snapshot={MOCK_SNAPSHOT} />
    );
    expect(screen.getAllByTestId('diff-content').length).toBe(3);
  });

  it('点击标题折叠/展开', () => {
    render(
      <DiffPreviewView preview={MOCK_PREVIEW} snapshot={MOCK_SNAPSHOT} />
    );
    // 找到第一个 file-change 的标题
    const firstChange = screen.getAllByTestId('file-change')[0];
    const header = firstChange.querySelector('div[class*="cursor-pointer"]');
    if (header) {
      fireEvent.click(header);
    }
    // 折叠后第一个应该没有 diff-content
    expect(firstChange.querySelector('[data-testid="diff-content"]')).toBeNull();
  });

  it('关闭按钮', () => {
    const onClose = vi.fn();
    render(
      <DiffPreviewView
        preview={MOCK_PREVIEW}
        snapshot={MOCK_SNAPSHOT}
        onClose={onClose}
      />
    );
    fireEvent.click(screen.getByTestId('diff-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('点击遮罩关闭', () => {
    const onClose = vi.fn();
    render(
      <DiffPreviewView
        preview={MOCK_PREVIEW}
        snapshot={MOCK_SNAPSHOT}
        onClose={onClose}
      />
    );
    const preview = screen.getByTestId('diff-preview');
    fireEvent.click(preview);
    expect(onClose).toHaveBeenCalled();
  });

  it('空预览', () => {
    const emptyPreview = { snapshot_id: 's', files: [], created_at: 0 };
    render(
      <DiffPreviewView preview={emptyPreview} snapshot={MOCK_SNAPSHOT} />
    );
    expect(screen.getByText(/快照无文件/)).toBeTruthy();
  });

  it('unchanged 文件不默认展开', () => {
    const preview = {
      ...MOCK_PREVIEW,
      files: [
        {
          path: '/unchanged.py',
          change_type: 'unchanged',
          diff: '',
          additions: 0,
          deletions: 0,
        },
      ],
    };
    render(<DiffPreviewView preview={preview} snapshot={MOCK_SNAPSHOT} />);
    // unchanged 不应有 diff-content
    expect(screen.queryByTestId('diff-content')).toBeNull();
  });
});
