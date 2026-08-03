/**
 * # ============================================================
 * useLoopState 单元测试 (v1.0.0)
 * Cycle 58 G58-03
 * # ============================================================
 * 核心作用：验证 Loop 状态机客户端 Hook 的所有功能
 * 运行流程：
 *   1. 测试 fetch 拉取与 SSE 订阅
 *   2. 测试节流更新逻辑
 *   3. 测试 history 累积
 *   4. 测试 error 状态、refresh、清理
 * 输入参数：无（通过 vitest 驱动）
 * 输出结果：测试报告
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-03 初次创建
 * ====================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoopState } from './useLoopState';

// ============================================================
// Mock EventSource
// ====================================

type EventListener = (e: MessageEvent) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  readyState = 0;
  onerror: ((e: Event) => void) | null = null;
  private listeners = new Map<string, EventListener[]>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type)!.push(listener);
  }

  removeEventListener(type: string, listener: EventListener) {
    const list = this.listeners.get(type);
    if (list) {
      const idx = list.indexOf(listener);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  dispatch(type: string, data: unknown) {
    const list = this.listeners.get(type) ?? [];
    const event = { data: JSON.stringify(data) } as MessageEvent;
    list.forEach((l) => l(event));
  }

  close() {
    this.readyState = 2;
  }
}

// 替换全局 EventSource
const origEventSource = (globalThis as any).EventSource;
(globalThis as any).EventSource = MockEventSource;

// ============================================================
// 测试
// ====================================

describe('useLoopState', () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.restoreAllMocks();
    // 默认 fetch mock：返回 never-resolving promise，避免与 SSE dispatch 竞态
    global.fetch = vi.fn(() => new Promise(() => {})) as any;
  });

  /**
   * 工具：渲染并等待首次 refresh 完成
   */
  const setupWithImmediateFetch = async (
    fetchResponse: { state: any; history: any[] },
    hookOptions: Parameters<typeof useLoopState>[0] = {}
  ) => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(fetchResponse),
      })
    ) as any;
    const hook = renderHook(() => useLoopState(hookOptions));
    // 触发主动 refresh
    await act(async () => {
      await hook.result.current.refresh();
    });
    return hook;
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('初始渲染 state 应为 null', () => {
    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    // 立即调用 refresh 之前
    expect(result.current.state).toBeNull();
    expect(result.current.progress).toBe(0);
    expect(result.current.eta).toBe(0);
    expect(result.current.history).toEqual([]);
  });

  it('创建 EventSource 时使用正确的 URL', () => {
    renderHook(() => useLoopState({ sessionId: 'my-session' }));
    expect(MockEventSource.instances.length).toBe(1);
    expect(MockEventSource.instances[0].url).toContain('/api/loop-state/machine/events');
    expect(MockEventSource.instances[0].url).toContain('session_id=my-session');
  });

  it('无 sessionId 时 URL 不含 query', () => {
    renderHook(() => useLoopState());
    expect(MockEventSource.instances[0].url).toBe('/api/loop-state/machine/events');
  });

  it('refresh 成功更新 state', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            state: {
              stage: 'clarifying',
              progress: 0.3,
              eta_seconds: 60,
              session_id: 's1',
              sub_state: { foo: 'bar' },
            },
            history: [
              { from_state: 'idle', to_state: 'clarifying', at: '2026-01-01', metadata: {} },
            ],
          }),
      })
    ) as any;

    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.state?.stage).toBe('clarifying');
    expect(result.current.progress).toBe(0.3);
    expect(result.current.eta).toBe(60);
    expect(result.current.history.length).toBe(1);
  });

  it('refresh 失败时设置 error', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      })
    ) as any;

    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toContain('500');
  });

  it('SSE loop_state_changed 事件应更新 state', async () => {
    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    const es = MockEventSource.instances[0];

    await act(async () => {
      es.dispatch('loop_state_changed', {
        stage: 'designing',
        progress: 0.5,
        eta_seconds: 120,
        session_id: 's1',
        sub_state: {},
      });
    });

    expect(result.current.state?.stage).toBe('designing');
    expect(result.current.progress).toBe(0.5);
    expect(result.current.eta).toBe(120);
  });

  it('SSE 事件应累加 history', async () => {
    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    const es = MockEventSource.instances[0];

    await act(async () => {
      es.dispatch('loop_state_changed', {
        stage: 'clarifying',
        progress: 0.1,
        eta_seconds: 10,
        session_id: 's1',
        sub_state: {},
      });
    });
    await act(async () => {
      es.dispatch('loop_state_changed', {
        stage: 'designing',
        progress: 0.3,
        eta_seconds: 30,
        session_id: 's1',
        sub_state: {},
      });
    });

    expect(result.current.history.length).toBe(2);
    expect(result.current.history[0].to_state).toBe('clarifying');
    expect(result.current.history[1].to_state).toBe('designing');
  });

  it('重复相同 stage 的 SSE 事件不应增加 history', async () => {
    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    const es = MockEventSource.instances[0];

    await act(async () => {
      es.dispatch('loop_state_changed', {
        stage: 'clarifying',
        progress: 0.1,
        eta_seconds: 10,
        session_id: 's1',
        sub_state: {},
      });
    });
    await act(async () => {
      es.dispatch('loop_state_changed', {
        stage: 'clarifying',
        progress: 0.2,
        eta_seconds: 9,
        session_id: 's1',
        sub_state: {},
      });
    });

    expect(result.current.history.length).toBe(1);
  });

  it('SSE 事件节流：连续事件应在节流后只应用最后一个', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useLoopState({ sessionId: 's1', throttleMs: 1000 })
    );
    const es = MockEventSource.instances[0];

    await act(async () => {
      es.dispatch('loop_state_changed', {
        stage: 'clarifying',
        progress: 0.1,
        eta_seconds: 10,
        session_id: 's1',
        sub_state: {},
      });
    });
    // state 应该立即更新（throttle 内）
    expect(result.current.state?.stage).toBe('clarifying');

    // 第二次更新（在 1s 节流窗口内）
    es.dispatch('loop_state_changed', {
      stage: 'designing',
      progress: 0.5,
      eta_seconds: 30,
      session_id: 's1',
      sub_state: {},
    });
    // 还没到时间，state 不变
    expect(result.current.state?.stage).toBe('clarifying');

    // 推进时间
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    // 现在应变成 designing
    expect(result.current.state?.stage).toBe('designing');

    vi.useRealTimers();
  });

  it('history 超过 MAX_HISTORY 应截断', async () => {
    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    const es = MockEventSource.instances[0];

    // 派发 102 个不同 stage
    const stages = ['clarifying', 'designing', 'prompting', 'executing', 'reviewing', 'done'];
    for (let i = 0; i < 102; i++) {
      await act(async () => {
        es.dispatch('loop_state_changed', {
          stage: stages[i % stages.length],
          progress: i / 102,
          eta_seconds: 100 - i,
          session_id: 's1',
          sub_state: {},
        });
      });
    }

    expect(result.current.history.length).toBeLessThanOrEqual(100);
  });

  it('SSE 解析失败不应抛错', async () => {
    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    const es = MockEventSource.instances[0];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      // 直接派发一个会 parse 失败的事件
      const listener = (es as any).listeners.get('loop_state_changed')?.[0];
      if (listener) {
        listener({ data: '{ invalid json' } as MessageEvent);
      }
    });

    expect(warnSpy).toHaveBeenCalled();
    expect(result.current.state).toBeNull();
  });

  it('卸载时应关闭 EventSource 并清理 timer', async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() =>
      useLoopState({ sessionId: 's1', throttleMs: 1000 })
    );
    const es = MockEventSource.instances[0];
    const closeSpy = vi.spyOn(es, 'close');

    unmount();

    expect(closeSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('重复渲染时旧的 EventSource 应被关闭', () => {
    const { rerender } = renderHook(
      ({ sessionId }) => useLoopState({ sessionId }),
      { initialProps: { sessionId: 'a' } }
    );
    expect(MockEventSource.instances.length).toBe(1);
    const firstEs = MockEventSource.instances[0];
    const closeSpy = vi.spyOn(firstEs, 'close');

    rerender({ sessionId: 'b' });

    expect(closeSpy).toHaveBeenCalled();
    expect(MockEventSource.instances.length).toBe(2);
  });

  it('custom baseUrl 应生效', () => {
    renderHook(() => useLoopState({ baseUrl: '/api/custom', sessionId: 's' }));
    expect(MockEventSource.instances[0].url).toContain('/api/custom/machine/events');
  });

  it('fetch error 应当被处理并写入 error 字段', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('network down'))) as any;
    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toContain('network down');
  });

  it('progress / eta 派生值在 state 为 null 时返回 0', () => {
    const { result } = renderHook(() => useLoopState({ sessionId: 's1' }));
    expect(result.current.progress).toBe(0);
    expect(result.current.eta).toBe(0);
  });
});
