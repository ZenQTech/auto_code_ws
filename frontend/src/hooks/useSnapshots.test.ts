/**
 * # ============================================================
 * # useSnapshots Hook 单元测试
 * # Cycle 66 G66-02
 * # ====================================
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSnapshots } from './useSnapshots';

// ============================================================
// Mock fetch
// ============================================================

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  mockFetch.mockReset();
  // 默认 mock: list 端点返回空列表
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/snapshots/') && !url.includes('?session_id')) {
      return {
        ok: true,
        json: async () => ({ success: true, snapshot: {}, result: {} }),
      };
    }
    return {
      ok: true,
      json: async () => ({ success: true, snapshots: [], total: 0 }),
    };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSnapshots', () => {
  // ============================================================
  // 基础功能
  // ============================================================

  it('初始状态正确', async () => {
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.snapshots).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it('refresh 加载快照列表', async () => {
    let listCalled = 0;
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('session_id=')) {
        listCalled++;
        return {
          ok: true,
          json: async () => ({
            success: true,
            snapshots: [
              {
                snapshot_id: 'snap-1',
                session_id: 's1',
                agent_id: 'a1',
                trigger: 'manual',
                description: 'test',
                files: [],
                file_count: 1,
                total_size: 10,
                created_at: 1000.0,
              },
            ],
            total: 1,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await waitFor(() => {
      expect(result.current.snapshots.length).toBe(1);
    });
    expect(result.current.snapshots[0].snapshot_id).toBe('snap-1');
    expect(result.current.total).toBe(1);
    expect(listCalled).toBeGreaterThan(0);
  });

  it('refresh 处理 HTTP 错误', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      json: async () => ({}),
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
    expect(result.current.error).toContain('refresh');
  });

  it('refresh 处理网络异常', async () => {
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new Error('Network failed'));
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
  });

  it('空 sessionId 不发送请求', async () => {
    const { result } = renderHook(() => useSnapshots({ sessionId: '' }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.snapshots).toEqual([]);
  });

  // ============================================================
  // create
  // ============================================================

  it('create 创建快照', async () => {
    let postCalled = false;
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === 'POST' && !url.match(/snapshots\/[^/]+$/)) {
        postCalled = true;
        return {
          ok: true,
          json: async () => ({
            success: true,
            snapshot: {
              snapshot_id: 'new-snap',
              session_id: 's1',
              agent_id: 'a1',
              trigger: 'manual',
              description: 'test',
              files: [],
              file_count: 0,
              total_size: 0,
              created_at: 2000.0,
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      // 等待初始 refresh
      await new Promise((r) => setTimeout(r, 10));
    });
    let snap: any = null;
    await act(async () => {
      snap = await result.current.create({
        paths: ['/tmp/x.py'],
        agentId: 'a1',
        trigger: 'manual',
      });
    });
    expect(snap).toBeTruthy();
    expect(snap.snapshot_id).toBe('new-snap');
    expect(postCalled).toBe(true);
  });

  it('create 失败返回 null', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === 'POST' && !url.match(/snapshots\/[^/]+$/)) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ detail: 'Invalid' }),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let snap: any = 'sentinel';
    await act(async () => {
      snap = await result.current.create({
        paths: [],
        agentId: 'a1',
      });
    });
    expect(snap).toBe(null);
    expect(result.current.error).toBeTruthy();
  });

  it('create 缺少 sessionId 返回 null', async () => {
    const { result } = renderHook(() => useSnapshots({ sessionId: '' }));
    let snap: any = 'sentinel';
    await act(async () => {
      snap = await result.current.create({
        paths: ['/tmp/x.py'],
        agentId: 'a1',
      });
    });
    expect(snap).toBe(null);
    expect(result.current.error).toBeTruthy();
  });

  // ============================================================
  // remove
  // ============================================================

  it('remove 删除快照', async () => {
    let deleteUrl = '';
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === 'DELETE') {
        deleteUrl = url;
        return { ok: true, json: async () => ({ success: true }) };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let success = false;
    await act(async () => {
      success = await result.current.remove('snap-1');
    });
    expect(success).toBe(true);
    expect(deleteUrl).toBe('/api/snapshots/snap-1');
  });

  it('remove 404 视作成功', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === 'DELETE') {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let success = false;
    await act(async () => {
      success = await result.current.remove('nonexistent');
    });
    expect(success).toBe(true);
  });

  it('remove 500 失败', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (opts?.method === 'DELETE') {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let success = true;
    await act(async () => {
      success = await result.current.remove('snap-1');
    });
    expect(success).toBe(false);
  });

  // ============================================================
  // restore
  // ============================================================

  it('restore 成功', async () => {
    let restoreUrl = '';
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('/restore')) {
        restoreUrl = url;
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: {
              success: true,
              status: 'completed',
              applied: ['/tmp/x.py'],
              failed: [],
              conflicts: [],
              message: 'OK',
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let res: any = null;
    await act(async () => {
      res = await result.current.restore('snap-1', { force: false });
    });
    expect(res).toBeTruthy();
    expect(res.status).toBe('completed');
    expect(restoreUrl).toBe('/api/snapshots/snap-1/restore');
  });

  it('restore 冲突 409 返回 pending_confirm', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
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
                { path: '/tmp/x.py', type: 'file_modified', expected_hash: 'h1', actual_hash: 'h2' },
              ],
              message: 'Detected 1 conflict',
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let res: any = null;
    await act(async () => {
      res = await result.current.restore('snap-1');
    });
    expect(res).toBeTruthy();
    expect(res.status).toBe('pending_confirm');
    expect(res.conflicts.length).toBe(1);
  });

  it('restore 404 返回 null', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('/restore')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let res: any = 'sentinel';
    await act(async () => {
      res = await result.current.restore('nonexistent');
    });
    expect(res).toBe(null);
  });

  it('restore 传递 force 和 actor', async () => {
    let body: any = null;
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('/restore')) {
        body = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: { success: true, status: 'completed', applied: [], failed: [], conflicts: [], message: 'OK' },
          }),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      await result.current.restore('snap-1', { force: true, actor: 'tester' });
    });
    expect(body.force).toBe(true);
    expect(body.actor).toBe('tester');
  });

  // ============================================================
  // preview
  // ============================================================

  it('preview 加载 diff', async () => {
    let previewUrl = '';
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('/preview')) {
        previewUrl = url;
        return {
          ok: true,
          json: async () => ({
            success: true,
            preview: {
              snapshot_id: 'snap-1',
              files: [
                { path: '/tmp/x.py', change_type: 'modify', diff: '@@ ...', additions: 1, deletions: 1 },
              ],
              created_at: 1000,
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let preview: any = null;
    await act(async () => {
      preview = await result.current.preview('snap-1');
    });
    expect(preview).toBeTruthy();
    expect(preview.files.length).toBe(1);
    expect(previewUrl).toBe('/api/snapshots/snap-1/preview');
  });

  it('preview 传 paths', async () => {
    let previewUrl = '';
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('/preview')) {
        previewUrl = url;
        return {
          ok: true,
          json: async () => ({
            success: true,
            preview: { snapshot_id: 'snap-1', files: [], created_at: 1000 },
          }),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      await result.current.preview('snap-1', ['/tmp/a.py', '/tmp/b.py']);
    });
    expect(previewUrl).toContain('paths=');
  });

  it('preview 404 返回 null', async () => {
    mockFetch.mockImplementation(async (url: string, opts: any) => {
      if (url.includes('/preview')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({}),
        };
      }
      return { ok: true, json: async () => ({ success: true, snapshots: [], total: 0 }) };
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    let preview: any = 'sentinel';
    await act(async () => {
      preview = await result.current.preview('nonexistent');
    });
    expect(preview).toBe(null);
  });

  // ============================================================
  // 错误处理
  // ============================================================

  it('clearError 清除错误', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const { result } = renderHook(() => useSnapshots({ sessionId: 's1' }));
    await waitFor(() => {
      expect(result.current.error).toBeTruthy();
    });
    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBe(null);
  });
});
