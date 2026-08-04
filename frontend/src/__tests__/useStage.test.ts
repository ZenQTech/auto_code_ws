/**
 * # ============================================================
 * # useStage Hook 单元测试
 * # Cycle 63 G63-03
 * # ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import { useStage } from '../hooks/useStage';

const originalFetch = globalThis.fetch;

const mockState = {
  session_id: 'sess-1',
  stage: 'coding',
  substage: null,
  confidence: 0.85,
  auto_follow: true,
  entered_at: 1700000000,
  source: 'rule',
  reason: 'test reason',
};

describe('useStage - 基础', () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('应正确初始化 hook', () => {
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    expect(result.current.state).toBeNull();
    expect(result.current.recentEvents).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.connected).toBe(false);
  });

  it('缺少 sessionId 时 refresh 不发起请求', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: '' }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refresh 应正确获取阶段状态', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: mockState }),
    }) as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.state).toEqual(mockState);
  });

  it('refresh 网络错误应写入 error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toContain('network');
  });

  it('detect 应调用 POST /detect', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: { ...mockState, stage: 'prd' } }),
    }) as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    let newState: any = null;
    await act(async () => {
      newState = await result.current.detect('let me create a PRD', false);
    });
    expect(newState?.stage).toBe('prd');
    expect(result.current.state?.stage).toBe('prd');
  });

  it('forceStage 应调用 POST /force', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: { ...mockState, stage: 'deploy', source: 'manual' } }),
    }) as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    let newState: any = null;
    await act(async () => {
      newState = await result.current.forceStage('deploy', 'user override');
    });
    expect(newState?.stage).toBe('deploy');
  });

  it('setAutoFollow 应切换 auto_follow 状态', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, state: { ...mockState, auto_follow: false } }),
    }) as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    await act(async () => {
      await result.current.setAutoFollow(false);
    });
    expect(result.current.state?.auto_follow).toBe(false);
  });

  it('loadHistory 应加载历史事件', async () => {
    const events = [
      {
        event_id: 'e1',
        session_id: 'sess-1',
        type: 'stage_change',
        from_stage: 'idle',
        to_stage: 'prd',
        confidence: 0.9,
        reason: 'r1',
        timestamp: 1700000000,
      },
    ];
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, events, total: 1 }),
    }) as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    await act(async () => {
      await result.current.loadHistory(10);
    });
    expect(result.current.history.length).toBe(1);
    expect(result.current.history[0].to_stage).toBe('prd');
  });

  it('clearError 应清空错误', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toContain('boom');
    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBeNull();
  });

  it('detect HTTP 错误应包含 detail', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'bad request' }),
    }) as typeof fetch;
    const { result } = renderHook(() => useStage({ sessionId: 'sess-1' }));
    await act(async () => {
      const r = await result.current.detect('foo');
      expect(r).toBeNull();
    });
    expect(result.current.error).toContain('bad request');
  });
});
