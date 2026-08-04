/**
 * # ============================================================
 * useAutoFollow Hook v2.0.0 单元测试
 * Cycle 61 G61-03-T6
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-03-T6 初次创建
 * ====================================
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoFollow, type AutoFollowEvent, type AutoFollowConfig } from '../hooks/useAutoFollow';
import { useModals } from '../hooks/useModals';

describe('useAutoFollow v2.0.0 - 基础状态', () => {
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

describe('useAutoFollow v2.0.0 - 节流与优先级', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('100ms 内同类型事件应被节流', () => {
    vi.useFakeTimers();
    const { result: modalsResult } = renderHook(() => useModals());
    const { result: af } = renderHook(() =>
      useAutoFollow(modalsResult.current, { throttleMs: 100 })
    );

    const ev1: AutoFollowEvent = { type: 'vibe_step_started', timestamp: Date.now() };
    const ev2: AutoFollowEvent = { type: 'vibe_step_started', timestamp: Date.now() + 50 };

    act(() => af.current.follow(ev1));
    act(() => af.current.follow(ev2)); // 50ms 后同类型事件

    // 历史中只有一次 follow 记录（第二次被节流）
    expect(af.current.history.length).toBe(1);
  });

  it('超过 throttleMs 后的同类型事件应能触发', () => {
    vi.useFakeTimers();
    const { result: modalsResult } = renderHook(() => useModals());
    const { result: af } = renderHook(() =>
      useAutoFollow(modalsResult.current, { throttleMs: 100 })
    );

    const ev1: AutoFollowEvent = { type: 'vibe_step_started', timestamp: Date.now() };
    act(() => af.current.follow(ev1));
    act(() => {
      vi.advanceTimersByTime(150);
    });

    const ev2: AutoFollowEvent = { type: 'vibe_step_started', timestamp: Date.now() + 150 };
    act(() => af.current.follow(ev2));

    expect(af.current.history.length).toBe(2);
  });

  it('高优先级事件（step_failed）应绕过节流', () => {
    vi.useFakeTimers();
    const { result: modalsResult } = renderHook(() => useModals());
    const { result: af } = renderHook(() =>
      useAutoFollow(modalsResult.current, { throttleMs: 100 })
    );

    const ev1: AutoFollowEvent = { type: 'vibe_step_failed', timestamp: Date.now() };
    const ev2: AutoFollowEvent = { type: 'vibe_step_failed', timestamp: Date.now() + 10 };

    act(() => af.current.follow(ev1));
    act(() => af.current.follow(ev2));

    // 高优先级应该都触发
    expect(af.current.history.length).toBe(2);
  });
});

describe('useAutoFollow v2.0.0 - Sticky Tool 保护', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sticky panel 不应被自动切换', () => {
    vi.useFakeTimers();
    const { result: modalsResult } = renderHook(() => useModals());
    const { result: af } = renderHook(() =>
      useAutoFollow(modalsResult.current, {
        initialStickyTools: ['vibeCoding'],
      })
    );

    act(() => {
      af.current.addSticky('vibeCoding');
    });
    expect(af.current.stickyTools).toContain('vibeCoding');

    // vibe_code_writing 映射到 vibeCoding，但因 sticky 保护，不应触发
    const ev: AutoFollowEvent = { type: 'vibe_code_writing', timestamp: Date.now() };
    act(() => af.current.follow(ev));

    // history 应该为空（vibeCoding 被 sticky 保护）
    expect(af.current.history.length).toBe(0);
  });

  it('removeSticky 后恢复自动切换', () => {
    vi.useFakeTimers();
    const { result: modalsResult } = renderHook(() => useModals());
    const { result: af } = renderHook(() =>
      useAutoFollow(modalsResult.current, {
        initialStickyTools: ['vibeCoding'],
      })
    );

    act(() => af.current.removeSticky('vibeCoding'));
    expect(af.current.stickyTools).not.toContain('vibeCoding');

    const ev: AutoFollowEvent = { type: 'vibe_code_writing', timestamp: Date.now() };
    act(() => af.current.follow(ev));

    expect(af.current.history.length).toBe(1);
  });
});

describe('useAutoFollow v2.0.0 - SplitView 切换', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('初始 splitView 应为 false（默认）', () => {
    const { result } = renderHook(() => useAutoFollow());
    expect(result.current.splitView).toBe(false);
  });

  it('initialSplitView=true 应初始化为 true', () => {
    const { result } = renderHook(() => useAutoFollow(undefined, { initialSplitView: true }));
    expect(result.current.splitView).toBe(true);
  });

  it('toggleSplitView 应切换状态', () => {
    const { result } = renderHook(() => useAutoFollow());
    expect(result.current.splitView).toBe(false);
    act(() => result.current.toggleSplitView());
    expect(result.current.splitView).toBe(true);
    act(() => result.current.toggleSplitView());
    expect(result.current.splitView).toBe(false);
  });
});

describe('useAutoFollow v2.0.0 - Predictive Switch', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('未触发事件时 predictNext 返回 null', () => {
    const { result } = renderHook(() => useAutoFollow());
    expect(result.current.predictNext()).toBeNull();
  });

  it('预测下一个可能 panel', () => {
    vi.useFakeTimers();
    const { result: modalsResult } = renderHook(() => useModals());
    const { result: af } = renderHook(() => useAutoFollow(modalsResult.current));

    // 触发 plan_generated，预测下一个是 step_started → planExecutor
    const ev: AutoFollowEvent = { type: 'vibe_plan_generated', timestamp: Date.now() };
    act(() => af.current.follow(ev));

    const next = af.current.predictNext();
    expect(next).toBe('planExecutor');
  });
});

describe('useAutoFollow v2.0.0 - 事件优先级', () => {
  it('priorities 字段应返回所有 15 个事件的优先级', () => {
    const { result } = renderHook(() => useAutoFollow());
    const p = result.current.priorities;
    expect(p.vibe_step_failed).toBeGreaterThan(p.vibe_step_started);
    expect(p.test_results_ready).toBeGreaterThan(p.vibe_step_completed);
  });
});

describe('useAutoFollow v2.0.0 - mapping 完整性', () => {
  it('mapping 字段应包含 15 个事件到 panel 的映射', () => {
    const { result } = renderHook(() => useAutoFollow());
    const m = result.current.mapping;
    const eventTypes: Array<keyof typeof m> = [
      'vibe_step_started',
      'vibe_plan_generated',
      'vibe_code_writing',
      'vibe_test_running',
      'vibe_step_completed',
      'vibe_step_failed',
      'vibe_plan_completed',
      'loop_state_changed',
      'claude_shell_output',
      'spec_review_requested',
      'goal_progress_updated',
      'subagent_spawned',
      'subagent_completed',
      'diff_preview_ready',
      'test_results_ready',
    ];
    for (const ev of eventTypes) {
      expect(m[ev]).toBeTruthy(); // 不为 null/undefined
    }
  });
});

describe('useAutoFollow v2.0.0 - reset', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('reset 应清除所有自定义状态', () => {
    const { result } = renderHook(() =>
      useAutoFollow(undefined, {
        initialStickyTools: ['vibeCoding'],
        initialSplitView: true,
        initialPredictive: false,
      })
    );

    act(() => {
      result.current.setEnabled(false);
      result.current.follow({ type: 'vibe_step_started', timestamp: Date.now() });
    });

    act(() => result.current.reset());

    expect(result.current.enabled).toBe(true);
    expect(result.current.splitView).toBe(false);
    expect(result.current.stickyTools).toEqual([]);
    expect(result.current.history).toEqual([]);
    expect(result.current.lastFollowed).toBeNull();
  });
});

describe('useAutoFollow v2.0.0 - config 同步', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('config 字段应包含完整配置', () => {
    const { result } = renderHook(() => useAutoFollow(undefined, { throttleMs: 150 }));
    const cfg: AutoFollowConfig = result.current.config;
    expect(cfg.throttleMs).toBe(150);
    expect(cfg.predictive).toBe(true);
    expect(cfg.splitView).toBe(false);
    expect(cfg.throttleStrategy).toBe('leading');
  });
});
