// @vitest-environment happy-dom
/**
 * # ============================================================
 * # ApplyPatchModal 组件测试
 * # Cycle 68 G68-02
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApplyPatchModal } from './ApplyPatchModal';

describe('ApplyPatchModal', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('isOpen=false 不渲染', () => {
    const { container } = render(
      <ApplyPatchModal isOpen={false} onClose={() => {}} />,
    );
    expect(container.querySelector('[data-testid="apply-patch-modal"]')).toBeNull();
  });

  it('isOpen=true 渲染弹窗', () => {
    render(<ApplyPatchModal isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('apply-patch-modal')).toBeTruthy();
    expect(screen.getByTestId('apply-patch-text')).toBeTruthy();
    expect(screen.getByTestId('apply-patch-root')).toBeTruthy();
  });

  it('点击关闭按钮', () => {
    let closed = false;
    render(<ApplyPatchModal isOpen={true} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId('apply-patch-close'));
    expect(closed).toBe(true);
  });

  it('预览 Patch', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        safe: true,
        ops_count: 1,
        diffs: [
          {
            file: 'a.py',
            type: 'update',
            before_hash: 'aaa',
            after_hash: 'bbb',
            diff: '--- a.py\n+++ b.py\n@@\n-old\n+new',
          },
        ],
        conflicts: [],
        error: '',
      }),
    });
    render(
      <ApplyPatchModal
        isOpen={true}
        onClose={() => {}}
        defaultRoot="/root"
        defaultPatch={'*** Begin Patch\n*** End Patch'}
      />,
    );
    fireEvent.click(screen.getByTestId('apply-patch-preview'));
    await waitFor(() => {
      expect(screen.getByTestId('apply-patch-preview-result')).toBeTruthy();
    });
  });

  it('冲突时显示 safe=false', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        safe: false,
        ops_count: 1,
        diffs: [],
        conflicts: [
          { file: 'a.py', expected_hash: 'aaa', actual_hash: 'bbb', op_type: 'add', reason: 'exists' },
        ],
        error: '',
      }),
    });
    render(
      <ApplyPatchModal isOpen={true} onClose={() => {}} defaultRoot="/root" />,
    );
    fireEvent.click(screen.getByTestId('apply-patch-preview'));
    await waitFor(() => {
      expect(screen.getByTestId('apply-patch-conflicts')).toBeTruthy();
    });
  });

  it('应用 Patch 成功', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        snapshot_id: 'snap-1',
        applied_ops: 1,
        duration_ms: 30,
        error: '',
        failed_op: null,
        rolled_back: false,
        diffs: [],
      }),
    });
    let appliedArgs: any = null;
    render(
      <ApplyPatchModal
        isOpen={true}
        onClose={() => {}}
        defaultRoot="/root"
        onApplied={(r) => { appliedArgs = r; }}
      />,
    );
    fireEvent.click(screen.getByTestId('apply-patch-apply'));
    await waitFor(() => {
      expect(screen.getByTestId('apply-patch-result')).toBeTruthy();
    });
    expect(appliedArgs).not.toBeNull();
    expect(appliedArgs.snapshot_id).toBe('snap-1');
  });

  it('应用 Patch 失败显示错误', async () => {
    const mockFetch = global.fetch as any;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: false,
        snapshot_id: null,
        applied_ops: 0,
        duration_ms: 5,
        error: 'apply_failed',
        failed_op: { type: 'update', file: 'a.py' },
        rolled_back: true,
        diffs: [],
      }),
    });
    render(<ApplyPatchModal isOpen={true} onClose={() => {}} defaultRoot="/root" />);
    fireEvent.click(screen.getByTestId('apply-patch-apply'));
    await waitFor(() => {
      expect(screen.getByTestId('apply-patch-result')).toBeTruthy();
    });
  });

  it('force 选项切换', () => {
    render(<ApplyPatchModal isOpen={true} onClose={() => {}} />);
    const forceCheckbox = screen.getByTestId('apply-patch-force') as HTMLInputElement;
    expect(forceCheckbox.checked).toBe(false);
    fireEvent.click(forceCheckbox);
    expect(forceCheckbox.checked).toBe(true);
  });
});
