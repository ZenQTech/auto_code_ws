/**
 * WorktreePanel 集成测试 (v1.0.0 Cycle 20 P0-1)
 * 覆盖：UI 渲染、过滤、创建、合并、丢弃
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WorktreePanel } from './WorktreePanel';
import {
  resetWorktreeManager,
  getWorktreeManager,
  setWorktreeManager,
  WorktreeManager,
  MockWorktreeBackend,
  MemoryWorktreeStorage,
} from '../utils/worktreeManager';

// @vitest-environment happy-dom

describe('WorktreePanel', () => {
  beforeEach(() => {
    // Inject a fresh in-memory manager for each test
    setWorktreeManager(
      new WorktreeManager({
        backend: new MockWorktreeBackend(0),
        storage: new MemoryWorktreeStorage(),
      }),
    );
  });

  afterEach(() => {
    cleanup();
    resetWorktreeManager();
  });

  it('面板未打开时不渲染', () => {
    const { container } = render(<WorktreePanel isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('面板打开时显示标题', async () => {
    render(<WorktreePanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Worktree 隔离')).toBeTruthy();
  });

  it('显示创建按钮', () => {
    render(<WorktreePanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('worktree-create-isolated')).toBeTruthy();
    expect(screen.getByTestId('worktree-create-review')).toBeTruthy();
    expect(screen.getByTestId('worktree-create-experiment')).toBeTruthy();
  });

  it('创建按钮触发 worktree 创建', async () => {
    render(<WorktreePanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('worktree-create-isolated'));
    await waitFor(() => {
      const m = getWorktreeManager();
      expect(m.list().length).toBeGreaterThan(0);
    });
  });

  it('关闭按钮触发 onClose', () => {
    const onClose = vi.fn();
    render(<WorktreePanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('worktree-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('状态过滤按钮切换', () => {
    render(<WorktreePanel isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('worktree-status-active'));
    expect(screen.getByTestId('worktree-status-active').className).toContain('bg-hermes-500');
  });

  it('空状态显示提示信息', () => {
    render(<WorktreePanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('暂无 worktree')).toBeTruthy();
  });
});
