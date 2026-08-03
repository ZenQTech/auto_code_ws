/**
 * # ============================================================
 * useVibeCoding Hook 单元测试 (v1.0.0)
 * Cycle 58 G58-01
 * # ============================================================
 * 测试覆盖：
 *   - 初始状态（idle）
 *   - startSession（创建 session、错误处理）
 *   - pause / resume / cancel
 *   - retryStep
 *   - SSE 事件订阅
 *   - 派生 completedSteps
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-01 初次创建
 * #   - 2026-08-03 | v1.0.1 | G60-FIX-7 修复：测试 mock 改为 { session: ... } 包装格式
 * #   - 2026-08-03 | v1.0.2 | G60-FIX-8 修复：新增 SSE step 事件格式测试
 * ====================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useVibeCoding, type VibeSession, type VibeStep } from './useVibeCoding';

describe('useVibeCoding - 基础状态', () => {
  beforeEach(() => {
    localStorage.clear();
    // 清除所有 mock
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初始状态应为 idle 且无 session', () => {
    const { result } = renderHook(() => useVibeCoding());
    expect(result.current.state).toBe('idle');
    expect(result.current.session).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.completedSteps).toEqual([]);
  });

  it('空 prompt 应设置错误', async () => {
    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.startSession('');
    });

    expect(result.current.error).toBe('prompt 不能为空');
  });

  it('过长 prompt 应设置错误', async () => {
    const { result } = renderHook(() => useVibeCoding());
    const longPrompt = 'a'.repeat(10001);

    await act(async () => {
      await result.current.startSession(longPrompt);
    });

    expect(result.current.error).toBe('prompt 长度不能超过 10000 字符');
  });
});

describe('useVibeCoding - startSession', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('成功创建 session 后应设置 session 和 state', async () => {
    const mockSession: VibeSession = {
      id: 'test-session-1',
      prompt: '测试需求',
      model: 'claude-sonnet-4-20250514',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'clarifying',
      steps: [],
      metrics: { tokens: 0, duration: 0, filesChanged: 0 },
    };

    // 后端响应格式：{ session: VibeSession } (G60-FIX-7 修复)
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session: mockSession }),
    } as Response);

    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.startSession('测试需求');
    });

    await waitFor(() => {
      expect(result.current.session).toEqual(mockSession);
    });
    expect(result.current.state).toBe('clarifying');
  });

  it('服务端错误应设置 error', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.startSession('测试需求');
    });

    expect(result.current.error).toContain('创建 session 失败');
  });

  it('网络异常应设置 error', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('网络错误'));

    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.startSession('测试需求');
    });

    expect(result.current.error).toBe('网络错误');
  });
});

describe('useVibeCoding - 状态控制', () => {
  let mockSession: VibeSession;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    mockSession = {
      id: 'test-session-2',
      prompt: '测试',
      model: 'claude-sonnet-4-20250514',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'executing',
      steps: [],
      metrics: { tokens: 0, duration: 0, filesChanged: 0 },
    };
  });

  it('pause 应将状态改为 paused', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session: mockSession }),
    } as Response).mockResolvedValueOnce({
      ok: true,
    } as Response);

    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.startSession('测试');
    });

    await waitFor(() => {
      expect(result.current.session).toEqual(mockSession);
    });

    await act(async () => {
      await result.current.pause();
    });

    expect(result.current.state).toBe('paused');
  });

  it('cancel 应将状态改为 cancelled', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session: mockSession }),
    } as Response).mockResolvedValueOnce({
      ok: true,
    } as Response);

    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.startSession('测试');
    });

    await waitFor(() => {
      expect(result.current.session).toEqual(mockSession);
    });

    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.state).toBe('cancelled');
  });

  it('无 session 时 pause / cancel 不应报错', async () => {
    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.pause();
      await result.current.resume();
      await result.current.cancel();
    });

    // 不应抛出错误
    expect(result.current.state).toBe('idle');
  });
});

describe('useVibeCoding - 派生数据', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('completedSteps 应只包含 completed 状态的 step', async () => {
    const mockSession: VibeSession = {
      id: 'test-session-3',
      prompt: '测试',
      model: 'claude-sonnet-4-20250514',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'executing',
      steps: [
        { id: 's1', name: 'step 1', status: 'completed' } as VibeStep,
        { id: 's2', name: 'step 2', status: 'running' } as VibeStep,
        { id: 's3', name: 'step 3', status: 'completed' } as VibeStep,
        { id: 's4', name: 'step 4', status: 'failed' } as VibeStep,
      ],
      metrics: { tokens: 0, duration: 0, filesChanged: 0 },
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session: mockSession }),
    } as Response);

    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.startSession('测试');
    });

    await waitFor(() => {
      expect(result.current.session).toEqual(mockSession);
    });

    expect(result.current.completedSteps).toHaveLength(2);
    expect(result.current.completedSteps.map((s) => s.id)).toEqual(['s1', 's3']);
  });
});

/**
 * G60-FIX-8: SSE step 事件数据格式修复
 * 后端通过 _broadcast_step 推送 { type, step: VibeStep, timestamp } 格式
 * 前端需要从 data.step 提取 step 对象，否则 UPDATE_STEP reducer 找不到 step.id
 */
describe('useVibeCoding - SSE step 事件格式 (G60-FIX-8)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('应能从 { type, step, timestamp } 格式中正确提取 step 并更新 session', async () => {
    const initialSession: VibeSession = {
      id: 'test-sse-1',
      prompt: '测试 SSE',
      model: 'claude-sonnet-4-20250514',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      state: 'clarifying',
      steps: [
        { id: 'step-1', name: '澄清需求', status: 'pending' } as VibeStep,
        { id: 'step-2', name: '生成 Plan', status: 'pending' } as VibeStep,
      ],
      metrics: { tokens: 0, duration: 0, filesChanged: 0 },
    };

    const updatedStep: VibeStep = {
      id: 'step-1',
      name: '澄清需求',
      status: 'completed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };

    // 模拟后端 SSE 推送的事件格式：{ type, step, timestamp }
    const sseEvent = {
      type: 'vibe_step_completed',
      step: updatedStep,
      timestamp: Date.now(),
    };

    // mock EventSource
    class MockEventSource {
      url: string;
      onerror: ((e: Event) => void) | null = null;
      private listeners: Map<string, Array<(e: MessageEvent) => void>> = new Map();
      constructor(url: string) {
        this.url = url;
        // 模拟接收 step_completed 事件
        setTimeout(() => {
          const handler = this.listeners.get('vibe_step_completed')?.[0];
          if (handler) {
            handler({ data: JSON.stringify(sseEvent) } as MessageEvent);
          }
        }, 10);
      }
      addEventListener(type: string, listener: (e: MessageEvent) => void) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type)!.push(listener);
      }
      close() { /* noop */ }
    }
    (global as any).EventSource = MockEventSource;

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ session: initialSession }),
    } as Response);

    const { result } = renderHook(() => useVibeCoding());

    await act(async () => {
      await result.current.startSession('测试 SSE');
    });

    await waitFor(() => {
      expect(result.current.session).toEqual(initialSession);
    });

    // 等待 SSE 事件处理
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // 验证 step-1 状态已更新为 completed
    const step1 = result.current.session?.steps.find((s) => s.id === 'step-1');
    expect(step1?.status).toBe('completed');
  });
});
