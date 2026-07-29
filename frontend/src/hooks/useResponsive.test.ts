/**
 * # ============================================================
 * 响应式工具 hook 单元测试（v1.0.0 P2-1）
 * # ============================================================
 * 覆盖点：
 *   - useMediaQuery 基础监听
 *   - useBreakpoint 断点判定
 *   - useIsMobile / useIsTablet / useIsDesktop 快捷判定
 *   - useViewport 视口尺寸
 *   - useSafeArea 安全区域
 * ============================================================
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useMediaQuery,
  useBreakpoint,
  useIsMobile,
  useIsTablet,
  useIsDesktop,
  useViewport,
  useSafeArea,
  BREAKPOINTS,
} from './useResponsive';

/** matchMedia 模拟器 */
type Listener = (e: { matches: boolean; media: string }) => void;

class MockMediaQueryList {
  matches: boolean;
  media: string;
  private listeners: Set<Listener> = new Set();

  constructor(query: string, initialMatches: boolean) {
    this.media = query;
    this.matches = initialMatches;
  }

  addEventListener(event: string, cb: Listener) {
    if (event === 'change') this.listeners.add(cb);
  }
  removeEventListener(event: string, cb: Listener) {
    if (event === 'change') this.listeners.delete(cb);
  }

  // 测试用：模拟断点变化
  setMatches(matches: boolean) {
    this.matches = matches;
    for (const cb of this.listeners) {
      cb({ matches, media: this.media });
    }
  }

  // 旧版 API 兼容
  addListener(cb: Listener) {
    this.addEventListener('change', cb);
  }
  removeListener(cb: Listener) {
    this.removeEventListener('change', cb);
  }
}

let mockLists: Map<string, MockMediaQueryList> = new Map();

function setMockMatchMedia(width: number) {
  mockLists = new Map();
  const queries: Record<string, number> = {
    [BREAKPOINTS.sm + 'px']: BREAKPOINTS.sm,
    [BREAKPOINTS.tablet + 'px']: BREAKPOINTS.tablet,
    [BREAKPOINTS.desktop + 'px']: BREAKPOINTS.desktop,
    [BREAKPOINTS.xl + 'px']: BREAKPOINTS.xl,
    [BREAKPOINTS.wide + 'px']: BREAKPOINTS.wide,
  };
  for (const [q, minWidth] of Object.entries(queries)) {
    const mql = new MockMediaQueryList(`(min-width: ${q})`, width >= minWidth);
    mockLists.set(`(min-width: ${q})`, mql);
  }
  // 默认实现：遍历 mockLists 找匹配
  window.matchMedia = vi.fn((query: string) => {
    if (mockLists.has(query)) return mockLists.get(query)!;
    return new MockMediaQueryList(query, false);
  }) as unknown as typeof window.matchMedia;
}

describe('useMediaQuery', () => {
  beforeEach(() => {
    setMockMatchMedia(1200);
  });

  it('初始值反映当前视口', () => {
    setMockMatchMedia(800);
    const { result } = renderHook(() => useMediaQuery(`(min-width: ${BREAKPOINTS.tablet}px)`));
    expect(result.current).toBe(true);
  });

  it('视口变化时更新匹配状态', () => {
    setMockMatchMedia(600);
    const { result } = renderHook(() => useMediaQuery(`(min-width: ${BREAKPOINTS.tablet}px)`));
    expect(result.current).toBe(false);
    // 模拟视口变化
    const mql = mockLists.get(`(min-width: ${BREAKPOINTS.tablet}px)`)!;
    act(() => mql.setMatches(true));
    expect(result.current).toBe(true);
  });

  it('无 window.matchMedia 时返回默认值', () => {
    const original = window.matchMedia;
    // @ts-expect-error: 故意删除
    delete window.matchMedia;
    const { result } = renderHook(() => useMediaQuery('(min-width: 100px)', true));
    expect(result.current).toBe(true);
    window.matchMedia = original;
  });
});

describe('useBreakpoint', () => {
  it('< 768px 返回 mobile', () => {
    setMockMatchMedia(500);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('mobile');
  });

  it('768px - 1024px 返回 tablet', () => {
    setMockMatchMedia(800);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('tablet');
  });

  it('1024px - 1280px 返回 desktop', () => {
    setMockMatchMedia(1100);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('desktop');
  });

  it('1280px - 1536px 返回 desktop（介于 xl 与 2xl 之间）', () => {
    setMockMatchMedia(1400);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('desktop');
  });

  it('≥ 1536px 返回 wide', () => {
    setMockMatchMedia(1600);
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe('wide');
  });
});

describe('useIsMobile / useIsTablet / useIsDesktop', () => {
  it('useIsMobile 在 500px 时为 true', () => {
    setMockMatchMedia(500);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('useIsMobile 在 800px 时为 false', () => {
    setMockMatchMedia(800);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('useIsTablet 在 800px 时为 true', () => {
    setMockMatchMedia(800);
    const { result } = renderHook(() => useIsTablet());
    expect(result.current).toBe(true);
  });

  it('useIsTablet 在 1100px 时为 false', () => {
    setMockMatchMedia(1100);
    const { result } = renderHook(() => useIsTablet());
    expect(result.current).toBe(false);
  });

  it('useIsDesktop 在 1100px 时为 true', () => {
    setMockMatchMedia(1100);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it('useIsDesktop 在 500px 时为 false', () => {
    setMockMatchMedia(500);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });
});

describe('useViewport', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1200, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, writable: true });
  });

  it('返回当前视口尺寸', () => {
    const { result } = renderHook(() => useViewport());
    expect(result.current.width).toBe(1200);
    expect(result.current.height).toBe(800);
  });

  it('resize 事件触发时更新尺寸', () => {
    const { result } = renderHook(() => useViewport());
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 500, writable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.width).toBe(500);
  });
});

describe('useSafeArea', () => {
  it('默认返回 0 值', () => {
    const { result } = renderHook(() => useSafeArea());
    expect(result.current.top).toBe(0);
    expect(result.current.right).toBe(0);
    expect(result.current.bottom).toBe(0);
    expect(result.current.left).toBe(0);
  });
});
