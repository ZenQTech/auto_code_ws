/**
 * # ============================================================
 * # SnapshotPanel 单元测试
 * # Cycle 66 G66-02
 * # ====================================
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnapshotPanel } from './SnapshotPanel';

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  mockFetch.mockReset();
  // 默认 list 返回空
  mockFetch.mockImplementation(async (url: string, opts: any) => {
    if (url.includes('/preview')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          preview: {
            snapshot_id: 'snap-1',
            files: [
              { path: '/a.py', change_type: 'modify', diff: '@@ -1 +1 @@\n-old\n+new', additions: 1, deletions: 1 },
            ],
            created_at: 1000,
          },
        }),
      };
    }
    if (opts?.method === 'DELETE') {
      return { ok: true, json: async () => ({ success: true }) };
    }
    if (url.includes('/restore')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          result: {
            success: true,
            status: 'completed',
            applied: ['/a.py'],
            failed: [],
            conflicts: [],
            message: 'OK',
          },
        }),
      };
    }
    if (opts?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          success: true,
          snapshot: {
            snapshot_id: 'new-snap',
            session_id: 's1',
            agent_id: 'a1',
            trigger: 'manual',
            description: '',
            files: [],
            file_count: 1,
            total_size: 10,
            created_at: Date.now() / 1000,
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ success: true, snapshots: [], total: 0 }),
    };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SnapshotPanel', () => {
  // ============================================================
  // 基础渲染
  // ============================================================

  it('渲染面板', async () => {
    render(<SnapshotPanel sessionId="s1" />);
    expect(screen.getByTestId('snapshot-panel')).toBeTruthy();
    expect(screen.getByText(/快照管理/)).toBeTruthy();
  });

  it('空状态显示提示', async () => {
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByText(/暂无快照/)).toBeTruthy();
    });
  });

  it('显示快照数量', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('session_id=')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 5,
            snapshots: [],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByText(/共 5 个快照/)).toBeTruthy();
    });
  });

  it('显示错误', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      // 错误信息
      expect(screen.getByText(/refresh/)).toBeTruthy();
    });
  });

  // ============================================================
  // 快照列表
  // ============================================================

  it('显示快照项', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('session_id=') && !url.match(/snapshots\/[^?]+/)) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 2,
            snapshots: [
              {
                snapshot_id: 'snap-1',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'manual',
                description: 'first',
                files: [],
                file_count: 1,
                total_size: 10,
                created_at: Date.now() / 1000,
              },
              {
                snapshot_id: 'snap-2',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'auto',
                description: 'second',
                files: [],
                file_count: 2,
                total_size: 20,
                created_at: Date.now() / 1000,
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('snapshot-item').length).toBe(2);
    });
  });

  it('显示触发类型徽章', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('session_id=') && !url.match(/snapshots\/[^?]+/)) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 1,
            snapshots: [
              {
                snapshot_id: 'snap-1',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'manual',
                description: '',
                files: [],
                file_count: 1,
                total_size: 10,
                created_at: Date.now() / 1000,
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getByText('手动')).toBeTruthy();
    });
  });

  // ============================================================
  // 创建
  // ============================================================

  it('点击新建按钮打开对话框', async () => {
    render(<SnapshotPanel sessionId="s1" />);
    fireEvent.click(screen.getByTestId('snapshot-create-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('snapshot-create-dialog')).toBeTruthy();
    });
  });

  it('提交创建快照', async () => {
    render(<SnapshotPanel sessionId="s1" />);
    fireEvent.click(screen.getByTestId('snapshot-create-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('snapshot-create-dialog')).toBeTruthy();
    });
    fireEvent.change(screen.getByTestId('create-paths'), {
      target: { value: '/tmp/a.py\n/tmp/b.py' },
    });
    fireEvent.change(screen.getByTestId('create-desc'), {
      target: { value: 'test snapshot' },
    });
    fireEvent.click(screen.getByTestId('create-submit'));
    await waitFor(() => {
      // 验证 POST 调用
      const calls = mockFetch.mock.calls.filter(
        (c: any) => c[1]?.method === 'POST'
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // 恢复
  // ============================================================

  it('点击恢复按钮', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('session_id=') && !url.match(/snapshots\/[^?]+/)) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 1,
            snapshots: [
              {
                snapshot_id: 'snap-1',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'manual',
                description: '',
                files: [],
                file_count: 1,
                total_size: 10,
                created_at: Date.now() / 1000,
              },
            ],
          }),
        };
      }
      if (url.includes('/restore')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: {
              success: true,
              status: 'completed',
              applied: ['/a.py'],
              failed: [],
              conflicts: [],
              message: 'OK',
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('snapshot-item').length).toBe(1);
    });
    fireEvent.click(screen.getByTestId('snapshot-restore-btn'));
    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter((c: any) =>
        c[0]?.includes('/restore')
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('冲突时显示确认对话框', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('session_id=') && !url.match(/snapshots\/[^?]+/)) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 1,
            snapshots: [
              {
                snapshot_id: 'snap-1',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'manual',
                description: '',
                files: [],
                file_count: 1,
                total_size: 10,
                created_at: Date.now() / 1000,
              },
            ],
          }),
        };
      }
      if (url.includes('/restore')) {
        return {
          ok: false,
          status: 409,
          json: async () => ({
            success: false,
            result: {
              success: false,
              status: 'pending_confirm',
              applied: [],
              failed: [],
              conflicts: [
                { path: '/a.py', type: 'file_modified', expected_hash: 'h1', actual_hash: 'h2' },
              ],
              message: 'Detected 1 conflict',
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('snapshot-item').length).toBe(1);
    });
    fireEvent.click(screen.getByTestId('snapshot-restore-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('undo-confirm-dialog')).toBeTruthy();
      expect(screen.getAllByTestId('conflict-item').length).toBe(1);
    });
  });

  // ============================================================
  // 预览
  // ============================================================

  it('点击预览按钮显示 diff', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('session_id=') && !url.match(/snapshots\/[^?]+/)) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 1,
            snapshots: [
              {
                snapshot_id: 'snap-1',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'manual',
                description: '',
                files: [],
                file_count: 1,
                total_size: 10,
                created_at: Date.now() / 1000,
              },
            ],
          }),
        };
      }
      if (url.includes('/preview')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            preview: {
              snapshot_id: 'snap-1',
              files: [
                { path: '/a.py', change_type: 'modify', diff: '@@ ...\n-old\n+new', additions: 1, deletions: 1 },
              ],
              created_at: 1000,
            },
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('snapshot-item').length).toBe(1);
    });
    fireEvent.click(screen.getByTestId('snapshot-preview-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('diff-preview')).toBeTruthy();
      expect(screen.getAllByTestId('file-change').length).toBe(1);
    });
  });

  // ============================================================
  // 删除
  // ============================================================

  it('点击删除按钮', async () => {
    window.confirm = vi.fn(() => true);
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('session_id=') && !url.match(/snapshots\/[^?]+/)) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 1,
            snapshots: [
              {
                snapshot_id: 'snap-1',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'manual',
                description: '',
                files: [],
                file_count: 1,
                total_size: 10,
                created_at: Date.now() / 1000,
              },
            ],
          }),
        };
      }
      if (opts?.method === 'DELETE') {
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('snapshot-item').length).toBe(1);
    });
    fireEvent.click(screen.getByTestId('snapshot-delete-btn'));
    await waitFor(() => {
      const calls = mockFetch.mock.calls.filter(
        (c: any) => c[1]?.method === 'DELETE'
      );
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  it('取消删除', async () => {
    window.confirm = vi.fn(() => false);
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('session_id=') && !url.match(/snapshots\/[^?]+/)) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            total: 1,
            snapshots: [
              {
                snapshot_id: 'snap-1',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'manual',
                description: '',
                files: [],
                file_count: 1,
                total_size: 10,
                created_at: Date.now() / 1000,
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    render(<SnapshotPanel sessionId="s1" />);
    await waitFor(() => {
      expect(screen.getAllByTestId('snapshot-item').length).toBe(1);
    });
    fireEvent.click(screen.getByTestId('snapshot-delete-btn'));
    await new Promise((r) => setTimeout(r, 50));
    const calls = mockFetch.mock.calls.filter(
      (c: any) => c[1]?.method === 'DELETE'
    );
    expect(calls.length).toBe(0);
  });

  // ============================================================
  // 刷新
  // ============================================================

  it('点击刷新按钮', async () => {
    render(<SnapshotPanel sessionId="s1" />);
    fireEvent.click(screen.getByTestId('snapshot-refresh-btn'));
    await waitFor(() => {
      // 至少有一次 list 调用
      const listCalls = mockFetch.mock.calls.filter(
        (c: any) => c[0]?.includes('session_id=')
      );
      expect(listCalls.length).toBeGreaterThan(0);
    });
  });
});
