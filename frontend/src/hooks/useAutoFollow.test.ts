/**
 * # ============================================================
 * useAutoFollow Hook 单元测试 (v1.0.0)
 * Cycle 58 G58-04
 * # ============================================================
 * 测试覆盖：
 *   - 初始 enabled 状态
 *   - setEnabled 切换
 *   - follow 触发 panel 切换
 *   - 防抖 500ms
 *   - 关闭后不再 follow
 *   - 持久化到 localStorage
 * ====================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-04 初次创建
 * ====================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoFollow, type AutoFollowEvent } from './useAutoFollow';
import { useModals } from './useModals';

describe('useAutoFollow - 基础状态', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认 enabled 状态应为 true', () => {
    const { result } = renderHook(() => useAutoFollow());
    expect(result.current.enabled).toBe(true);
  });

  it('setEnabled 应修改状态', () => {
    const { result } = renderHook(() => useAutoFollow());
    act(() => {
      result.current.setEnabled(false);
    });
    expect(result.current.enabled).toBe(false);
  });

  it('setEnabled 应持久化到 localStorage', () => {
    const { result } = renderHook(() => useAutoFollow());
    act(() => {
      result.current.setEnabled(false);
    });
    expect(localStorage.getItem('hermes.autoFollow.enabled')).toBe('false');
  });
});

describe('useAutoFollow - follow 行为', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('vibe_step_started 应触发 planExecutor panel 打开', async () => {
    vi.useFakeTimers();
    const { result: modalsResult } = renderHook(() => useModals());
    const { result: autoFollowResult } = renderHook(() =>
      useAutoFollow(modalsResult.current)
    );

    // 初始 planExecutor 应关闭
    expect(modalsResult.current.planExecutor.open).toBe(false);

    const event: AutoFollowEvent = {
      type: 'vibe_step_started',
      timestamp: Date.now(),
    };

    act(() => {
      autoFollowResult.current.follow(event);
    });

    // 防抖 500ms
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(autoFollowResult.current.lastFollowed?.panelId).toBe('planExecutor');
    expect(modalsResult.current.planExecutor.open).toBe(true);
  });

  it('vibe_plan_generated 应触发 planExecutor panel 打开', async () => {
    vi.useFakeTimers();
    const { result: autoFollowResult } = renderHook(() => useAutoFollow());

    const event: AutoFollowEvent = {
      type: 'vibe_plan_generated',
      timestamp: Date.now(),
    };

    act(() => {
      autoFollowResult.current.follow(event);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(autoFollowResult.current.lastFollowed?.panelId).toBe('planExecutor');
  });

  it('vibe_code_writing 应触发 vibeCoding panel 打开', async () => {
    vi.useFakeTimers();
    const { result: autoFollowResult } = renderHook(() => useAutoFollow());

    const event: AutoFollowEvent = {
      type: 'vibe_code_writing',
      timestamp: Date.now(),
    };

    act(() => {
      autoFollowResult.current.follow(event);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(autoFollowResult.current.lastFollowed?.panelId).toBe('vibeCoding');
  });

  it('loop_state_changed 应触发 loopState panel 打开', async () => {
    vi.useFakeTimers();
    const { result: autoFollowResult } = renderHook(() => useAutoFollow());

    const event: AutoFollowEvent = {
      type: 'loop_state_changed',
      timestamp: Date.now(),
    };

    act(() => {
      autoFollowResult.current.follow(event);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(autoFollowResult.current.lastFollowed?.panelId).toBe('loopState');
  });

  it('disabled 状态下不应 follow', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAutoFollow());

    act(() => {
      result.current.setEnabled(false);
    });

    const event: AutoFollowEvent = {
      type: 'vibe_step_started',
      timestamp: Date.now(),
    };

    act(() => {
      result.current.follow(event);
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.lastFollowed).toBeNull();
  });

  it('500ms 内多次 follow 应只触发最后一次', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAutoFollow());

    act(() => {
      result.current.follow({ type: 'vibe_step_started', timestamp: Date.now() });
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    act(() => {
      result.current.follow({ type: 'vibe_code_writing', timestamp: Date.now() });
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    // 只有最后的事件被触发
    expect(result.current.lastFollowed?.panelId).toBe('vibeCoding');
  });
});

describe('useAutoFollow - history 累积', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('每次 follow 应累加到 history', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAutoFollow());

    act(() => {
      result.current.follow({ type: 'vibe_step_started', timestamp: 1 });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    act(() => {
      result.current.follow({ type: 'vibe_step_completed', timestamp: 2 });
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.history.length).toBe(2);
  });
});
