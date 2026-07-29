/**
 * # ============================================================
 * 响应式断点 Hook（v6.36.0 P2-1 新增）
 * # ============================================================
 * 核心作用：提供响应式断点检测能力，让组件能够根据视口宽度
 *           渲染不同的 UI 变体（移动端/平板/桌面）
 * 运行流程：
 *   1. 组件挂载时立即读取 window.innerWidth 获取初始断点
 *   2. 监听 window resize 事件，实时更新断点状态
 *   3. 卸载时清理事件监听
 * 设计决策：
 *   - 使用 matchMedia API 替代 resize 事件监听（性能更好）
 *   - 断点与 Tailwind 默认断点保持一致（sm/md/lg/xl/2xl）
 *   - SSR 安全：初始值为 false，hydration 后再更新
 * 适用场景：
 *   - 抽屉式 Sidebar（移动端从左侧滑出）
 *   - 全屏 Modal（移动端 100% 宽）
 *   - 表格 → 卡片切换（移动端隐藏列）
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | P2-1 初始版本
 * #     - useMediaQuery: 通用断点检测
 * #     - useBreakpoint: 当前断点枚举
 * #     - useIsMobile / useIsTablet / useIsDesktop: 快捷判定
 * # ============================================================
 */

import { useEffect, useState, useCallback } from 'react';

/** 断点枚举（与 Tailwind 默认断点对齐） */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop' | 'wide';

/** 断点阈值（px），与 Tailwind 默认值保持一致 */
export const BREAKPOINTS = {
  /** < 640px: 移动端 */
  mobile: 0,
  /** 640px - 768px: 大屏手机 / 小平板（介于 sm 与 md 之间） */
  sm: 640,
  /** 768px - 1024px: 平板 */
  tablet: 768,
  /** 1024px - 1280px: 桌面 */
  desktop: 1024,
  /** 1280px - 1536px: 大屏桌面 */
  xl: 1280,
  /** ≥ 1536px: 超大屏 */
  wide: 1536,
} as const;

/** 断点对应的最小宽度 query 字符串（用于 matchMedia） */
const QUERIES = {
  sm: `(min-width: ${BREAKPOINTS.sm}px)`,
  md: `(min-width: ${BREAKPOINTS.tablet}px)`,
  lg: `(min-width: ${BREAKPOINTS.desktop}px)`,
  xl: `(min-width: ${BREAKPOINTS.xl}px)`,
  '2xl': `(min-width: ${BREAKPOINTS.wide}px)`,
} as const;

/**
 * 通用 matchMedia 监听 hook
 * @param query CSS media query 字符串
 * @param defaultValue SSR/初始默认值（默认 false）
 * @returns boolean 当前是否匹配
 */
export function useMediaQuery(query: string, defaultValue: boolean = false): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return defaultValue;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // 初始化一次（如果初始 useState 没拿到正确值）
    setMatches(mql.matches);
    // 现代浏览器使用 addEventListener，旧版 fallback 到 addListener
    if (mql.addEventListener) {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } else {
      // TypeScript 旧版兼容
      const legacyMql = mql as MediaQueryList & {
        addListener: (cb: (e: MediaQueryListEvent) => void) => void;
        removeListener: (cb: (e: MediaQueryListEvent) => void) => void;
      };
      legacyMql.addListener(handler);
      return () => legacyMql.removeListener(handler);
    }
  }, [query]);

  return matches;
}

/**
 * 当前断点检测（返回 mobile / tablet / desktop / wide）
 * 算法：检查从大到小的断点，返回第一个匹配的
 */
export function useBreakpoint(): Breakpoint {
  const isWide = useMediaQuery(QUERIES['2xl']);
  const isDesktop = useMediaQuery(QUERIES.lg);
  const isTablet = useMediaQuery(QUERIES.md);

  if (isWide) return 'wide';
  if (isDesktop) return 'desktop';
  if (isTablet) return 'tablet';
  return 'mobile';
}

/** 快捷判定：< 768px（移动端） */
export function useIsMobile(): boolean {
  return !useMediaQuery(QUERIES.md);
}

/** 快捷判定：768px - 1024px（平板） */
export function useIsTablet(): boolean {
  const isMd = useMediaQuery(QUERIES.md);
  const isLg = useMediaQuery(QUERIES.lg);
  return isMd && !isLg;
}

/** 快捷判定：≥ 1024px（桌面） */
export function useIsDesktop(): boolean {
  return useMediaQuery(QUERIES.lg);
}

/**
 * 视口尺寸 hook（用于需要精确宽度的场景，如布局计算）
 * @returns { width, height } 当前视口尺寸
 */
export function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    if (typeof window === 'undefined') return { width: 0, height: 0 };
    return { width: window.innerWidth, height: window.innerHeight };
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return size;
}

/**
 * 安全区域 hook（用于移动端 notch / home indicator 适配）
 * 返回 CSS env(safe-area-inset-*) 像素值（如果浏览器支持）
 */
export function useSafeArea(): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const getSafeArea = useCallback(() => {
    if (typeof window === 'undefined') return { top: 0, right: 0, bottom: 0, left: 0 };
    const style = getComputedStyle(document.documentElement);
    return {
      top: parseInt(style.getPropertyValue('--sat') || '0', 10) || 0,
      right: parseInt(style.getPropertyValue('--sar') || '0', 10) || 0,
      bottom: parseInt(style.getPropertyValue('--sab') || '0', 10) || 0,
      left: parseInt(style.getPropertyValue('--sal') || '0', 10) || 0,
    };
  }, []);

  const [safeArea, setSafeArea] = useState(getSafeArea);

  useEffect(() => {
    setSafeArea(getSafeArea());
  }, [getSafeArea]);

  return safeArea;
}

export default useMediaQuery;
