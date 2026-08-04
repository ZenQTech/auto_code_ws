/**
 * # ============================================================
 * useClaudeCLI Hook 单元测试
 * Cycle 61 G61-01-T8
 * # ====================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useClaudeCLI } from '../hooks/useClaudeCLI';

describe('useClaudeCLI - 初始状态', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('默认 isRunning 应为 false', () => {
    const { result } = renderHook(() => useClaudeCLI());
    expect(result.current.isRunning).toBe(false);
  });

  it('默认 state 应为 idle', () => {
    const { result } = renderHook(() => useClaudeCLI());
    expect(result.current.state).toBe('idle');
  });

  it('默认 processId 应为 null', () => {
    const { result } = renderHook(() => useClaudeCLI());
    expect(result.current.processId).toBeNull();
  });

  it('默认 output/thinking 应为空字符串', () => {
    const { result } = renderHook(() => useClaudeCLI());
    expect(result.current.output).toBe('');
    expect(result.current.thinking).toBe('');
  });

  it('默认 toolCalls/events/errors 应为空数组', () => {
    const { result } = renderHook(() => useClaudeCLI());
    expect(result.current.toolCalls).toEqual([]);
    expect(result.current.events).toEqual([]);
    expect(result.current.errors).toEqual([]);
  });
});

describe('useClaudeCLI - invoke 输入校验', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('空 prompt 应被拒绝', async () => {
    const { result } = renderHook(() => useClaudeCLI());
    await act(async () => {
      await result.current.invoke({ prompt: '' });
    });
    expect(result.current.errors.length).toBeGreaterThan(0);
  });

  it('超过 100000 字符的 prompt 应被拒绝', async () => {
    const { result } = renderHook(() => useClaudeCLI());
    await act(async () => {
      await result.current.invoke({ prompt: 'x'.repeat(100001) });
    });
    expect(result.current.errors.length).toBeGreaterThan(0);
  });
});

describe('useClaudeCLI - clear', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('clear 应重置所有状态', () => {
    const { result } = renderHook(() => useClaudeCLI());
    act(() => {
      result.current.clear();
    });
    expect(result.current.output).toBe('');
    expect(result.current.thinking).toBe('');
    expect(result.current.toolCalls).toEqual([]);
    expect(result.current.errors).toEqual([]);
    expect(result.current.events).toEqual([]);
    expect(result.current.state).toBe('idle');
    expect(result.current.processId).toBeNull();
  });
});

describe('useClaudeCLI - health check', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('健康检查失败应设置 isAvailable=false', async () => {
    // Mock fetch 返回失败
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ detail: 'service unavailable' }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useClaudeCLI());

    await act(async () => {
      await result.current.refreshHealth();
    });

    expect(result.current.isAvailable).toBe(false);
  });

  it('健康检查成功应填充 sandboxStatus', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        available: true,
        mode: 'subprocess',
        sandboxes: { docker: true, none: true, gvisor: false, firejail: false },
      }),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useClaudeCLI());

    await act(async () => {
      await result.current.refreshHealth();
    });

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(true);
    });
    expect(result.current.sandboxStatus.docker).toBe(true);
    expect(result.current.sandboxStatus.none).toBe(true);
  });
});

describe('useClaudeCLI - invoke 成功流程', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('invoke 成功应设置 processId', async () => {
    let fetchCallCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      fetchCallCount += 1;
      if (url.includes('/exec') && !url.includes('/events/')) {
        return {
          ok: true,
          json: async () => ({ id: 'cli-test-123', status: 'running' }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as unknown as typeof fetch;

    // Mock EventSource
    class MockEventSource {
      url: string;
      onerror: ((e: Event) => void) | null = null;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener() {}
      close() {}
    }
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

    const { result } = renderHook(() => useClaudeCLI());

    await act(async () => {
      await result.current.invoke({ prompt: 'hello' });
    });

    expect(result.current.processId).toBe('cli-test-123');
  });
});

describe('useClaudeCLI - cancel', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('cancel 应重置 isRunning 和 state', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useClaudeCLI());

    await act(async () => {
      await result.current.cancel();
    });

    expect(result.current.isRunning).toBe(false);
    expect(result.current.state).toBe('cancelled');
  });
});
