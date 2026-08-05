/**
 * # ============================================================
 * # UndoConfirmDialog 单元测试
 * # Cycle 66 G66-02
 * # ====================================
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UndoConfirmDialog } from './UndoConfirmDialog';

afterEach(() => {
  cleanup();
});

const MOCK_SNAPSHOT: any = {
  snapshot_id: 'snap-abc123def',
  session_id: 's1',
  agent_id: 'a1',
  trigger: 'manual',
  description: 'test',
  files: [],
  file_count: 2,
  total_size: 100,
  created_at: 1000.0,
};

const MOCK_CONFLICTS: any[] = [
  {
    path: '/tmp/a.py',
    type: 'file_modified',
    expected_hash: 'hash-original',
    actual_hash: 'hash-modified',
  },
  {
    path: '/tmp/b.py',
    type: 'file_deleted',
    expected_hash: 'hash-was-here',
    actual_hash: '',
  },
  {
    path: '/tmp/c.py',
    type: 'file_added',
    expected_hash: '',
    actual_hash: 'hash-new',
  },
];

describe('UndoConfirmDialog', () => {
  it('渲染对话框', () => {
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByTestId('undo-confirm-dialog')).toBeTruthy();
  });

  it('显示冲突数量', () => {
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/检测到 3 个冲突/)).toBeTruthy();
  });

  it('显示所有冲突项', () => {
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const items = screen.getAllByTestId('conflict-item');
    expect(items.length).toBe(3);
  });

  it('显示冲突类型标签', () => {
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('已修改')).toBeTruthy();
    expect(screen.getByText('已删除')).toBeTruthy();
    expect(screen.getByText('已新增')).toBeTruthy();
  });

  it('显示文件路径', () => {
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('/tmp/a.py')).toBeTruthy();
    expect(screen.getByText('/tmp/b.py')).toBeTruthy();
    expect(screen.getByText('/tmp/c.py')).toBeTruthy();
  });

  it('显示 hash 对比', () => {
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText('hash-original')).toBeTruthy();
    expect(screen.getByText('hash-modified')).toBeTruthy();
  });

  it('取消按钮', () => {
    const onCancel = vi.fn();
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.click(screen.getByTestId('undo-cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('确认按钮触发 onConfirm', () => {
    const onConfirm = vi.fn();
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('undo-confirm'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('点击遮罩关闭', () => {
    const onCancel = vi.fn();
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={MOCK_CONFLICTS}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );
    // 点击对话框外层（遮罩）
    const dialog = screen.getByTestId('undo-confirm-dialog');
    fireEvent.click(dialog);
    expect(onCancel).toHaveBeenCalled();
  });

  it('空冲突列表', () => {
    render(
      <UndoConfirmDialog
        snapshot={MOCK_SNAPSHOT}
        conflicts={[]}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.getByText(/检测到 0 个冲突/)).toBeTruthy();
  });
});
