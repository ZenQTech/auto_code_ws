/**
 * # ============================================================
 * # useThinkingStream Hook 单元测试
 * # Cycle 67 G67-01
 * # ====================================
 */

// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useThinkingStream } from './useThinkingStream';

// ============================================================
// Mock fetch
// ============================================================

const mockFetch = vi.fn();
global.fetch = mockFetch as any;

beforeEach(() => {
  mockFetch.mockReset();
  // 默认 mock: 返回空列表
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      session_id: 's1',
      total: 0,
      steps: [],
      stats: {
        session_id: 's1',
        total_steps: 0,
        total_tokens: 0,
        running_steps: 0,
        completed_steps: 0,
        truncated_steps: 0,
        total_duration_ms: 0,
      },
    }),
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 基础功能
// ====================================

describe('useThinkingStream', () => {
  it('初始状态正确', async () => {
    const { result } = renderHook(() =>
      useThinkingStream({ sessionId: 's1', autoLoad: false }),
    );
    expect(result.current.steps).toEqual([]);
    expect(result.current.currentStep).toBe(null);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('refresh 加载 step 列表', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/stats')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            session_id: 's1',
            total_steps: 2,
            total_tokens: 100,
            running_steps: 0,
            completed_steps: 2,
            truncated_steps: 0,
            total_duration_ms: 5000,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          session_id: 's1',
          total: 2,
          steps: [
            {
              step_id: 'think-1',
              session_id: 's1',
              agent_id: 'a1',
              step_index: 1,
              content: 'plan A',
              started_at: 1000,
              ended_at: 1002,
              status: 'completed',
              summary: 'plan A done',
              model: 'claude-opus',
              tokens: 50,
              duration_ms: 2000,
              metadata: {},
            },
            {
              step_id: 'think-0',
              session_id: 's1',
              agent_id: 'a1',
              step_index: 0,
              content: 'analyze',
              started_at: 1000,
              ended_at: 1001,
              status: 'completed',
              summary: 'analysis done',
              model: 'claude-opus',
              tokens: 50,
              duration_ms: 1000,
              metadata: {},
            },
          ],
        }),
      };
    });

    const { result } = renderHook(() => useThinkingStream({ sessionId: 's1' }));

    await waitFor(() => {
      expect(result.current.steps.length).toBe(2);
    });
    expect(result.current.totalSteps).toBe(2);
    expect(result.current.totalTokens).toBe(100);
    expect(result.current.totalDurationMs).toBe(3000);
  });

  it('refreshStats 加载统计信息', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/stats')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            session_id: 's1',
            total_steps: 5,
            total_tokens: 250,
            running_steps: 1,
            completed_steps: 4,
            truncated_steps: 0,
            total_duration_ms: 10000,
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { result } = renderHook(() => useThinkingStream({ sessionId: 's1' }));

    await waitFor(() => {
      expect(result.current.stats).not.toBe(null);
    });
    expect(result.current.stats?.total_steps).toBe(5);
  });

  it('clear 调用 DELETE 端点', async () => {
    mockFetch.mockImplementation(async (url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            session_id: 's1',
            cleared: 5,
            message: '已清空 5 个 step',
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { result } = renderHook(() => useThinkingStream({ sessionId: 's1' }));

    await act(async () => {
      await result.current.clear();
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/s1'),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('exportThinking 调用 export 端点', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('export')) {
        return {
          ok: true,
          json: async () => ({
            session_id: 's1',
            format: 'markdown',
            content: '# Thinking Stream',
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const { result } = renderHook(() => useThinkingStream({ sessionId: 's1' }));

    let content = '';
    await act(async () => {
      content = await result.current.exportThinking('markdown');
    });
    expect(content).toBe('# Thinking Stream');
  });

  it('错误时设置 error 状态', async () => {
    mockFetch.mockImplementation(async () => {
      throw new Error('Network error');
    });

    const { result } = renderHook(() => useThinkingStream({ sessionId: 's1' }));

    await waitFor(() => {
      expect(result.current.error).toBe('Network error');
    });
  });

  it('clearError 清空错误', async () => {
    mockFetch.mockImplementation(async () => {
      throw new Error('Test error');
    });

    const { result } = renderHook(() => useThinkingStream({ sessionId: 's1' }));

    await waitFor(() => {
      expect(result.current.error).not.toBe(null);
    });
    act(() => {
      result.current.clearError();
    });
    expect(result.current.error).toBe(null);
  });

  it('sessionId 变化时清空状态', async () => {
    const { result, rerender } = renderHook(
      ({ sid }: { sid: string }) => useThinkingStream({ sessionId: sid, autoLoad: false }),
      { initialProps: { sid: 's1' } },
    );
    expect(result.current.steps).toEqual([]);
    rerender({ sid: 's2' });
    expect(result.current.steps).toEqual([]);
    expect(result.current.currentStep).toBe(null);
  });
});

// ============================================================
// WebSocket
// =============================================================

describe('useThinkingStream WebSocket', () => {
  class MockWebSocket {
    readyState: number = 0; // CONNECTING
    onopen: ((ev: any) => void) | null = null;
    onmessage: ((ev: any) => void) | null = null;
    onclose: ((ev: any) => void) | null = null;
    onerror: ((ev: any) => void) | null = null;
    sent: any[] = [];
    url: string;

    constructor(url: string) {
      this.url = url;
    }

    send(data: any) {
      this.sent.push(data);
    }

    close() {
      this.readyState = 3; // CLOSED
      if (this.onclose) this.onclose({});
    }

    // 模拟服务器推送
    emit(type: string, data: any) {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify({ type, data }) });
      }
    }

    // 模拟连接打开
    open() {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen({});
    }
  }

  let lastWs: MockWebSocket | null = null;

  beforeEach(() => {
    lastWs = null;
    (global as any).WebSocket = function (url: string) {
      const ws = new MockWebSocket(url);
      lastWs = ws;
      return ws as any;
    };
  });

  afterEach(() => {
    delete (global as any).WebSocket;
  });

  it('autoConnect=true 时建立 ws 连接', async () => {
    renderHook(() =>
      useThinkingStream({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
        autoConnect: true,
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
  });

  it('ws open 后标记 connected', async () => {
    const { result } = renderHook(() =>
      useThinkingStream({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
    act(() => {
      lastWs!.open();
    });
    expect(result.current.connected).toBe(true);
  });

  it('收到 thinking_start 事件创建 current step', async () => {
    const { result } = renderHook(() =>
      useThinkingStream({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
    act(() => {
      lastWs!.open();
      lastWs!.emit('thinking_start', {
        step_id: 'think-1',
        session_id: 's1',
        agent_id: 'a1',
        step_index: 0,
        model: 'claude-opus',
      });
    });
    await waitFor(() => {
      expect(result.current.currentStep).not.toBe(null);
    });
    expect(result.current.currentStep?.step_id).toBe('think-1');
    expect(result.current.isStreaming).toBe(true);
  });

  it('收到 thinking_delta 更新 current content', async () => {
    const { result } = renderHook(() =>
      useThinkingStream({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
        throttleMs: 10,
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
    act(() => {
      lastWs!.open();
      lastWs!.emit('thinking_start', {
        step_id: 'think-1',
        session_id: 's1',
        agent_id: 'a1',
        step_index: 0,
      });
    });
    act(() => {
      lastWs!.emit('thinking_delta', {
        step_id: 'think-1',
        delta: 'Hello',
      });
    });
    // 等待节流
    await waitFor(
      () => {
        expect(result.current.currentStep?.content).toBe('Hello');
      },
      { timeout: 500 },
    );
  });

  it('收到 thinking_end 将 step 推入 history', async () => {
    const { result } = renderHook(() =>
      useThinkingStream({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
        throttleMs: 10,
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
    act(() => {
      lastWs!.open();
      lastWs!.emit('thinking_start', {
        step_id: 'think-1',
        session_id: 's1',
        agent_id: 'a1',
        step_index: 0,
      });
      lastWs!.emit('thinking_delta', {
        step_id: 'think-1',
        delta: 'Plan',
      });
      lastWs!.emit('thinking_end', {
        step_id: 'think-1',
        summary: 'decided X',
        tokens: 10,
        duration_ms: 2000,
      });
    });
    await waitFor(() => {
      expect(result.current.steps.length).toBe(1);
    });
    expect(result.current.steps[0].summary).toBe('decided X');
    expect(result.current.steps[0].status).toBe('completed');
    expect(result.current.currentStep).toBe(null);
    expect(result.current.isStreaming).toBe(false);
  });

  it('reconnect 重建连接', async () => {
    const { result } = renderHook(() =>
      useThinkingStream({
        sessionId: 's1',
        wsUrl: 'ws://localhost:8000/ws',
      }),
    );
    await waitFor(() => {
      expect(lastWs).not.toBe(null);
    });
    act(() => {
      lastWs!.open();
    });
    expect(result.current.connected).toBe(true);
    act(() => {
      result.current.reconnect();
    });
    await waitFor(() => {
      expect(result.current.connected).toBe(false);
    });
  });
});
