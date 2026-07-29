/**
 * # ============================================================
 * useDesignTokens - 运行时主题切换 Hook（v6.34.0 P1-3）
 * # ============================================================
 * 核心作用：在 JS 运行时按当前主题返回对应的 token 值，
 *           并支持切换深色/浅色/高对比度主题
 * 设计原则：
 *   - 与 tailwind.config.ts + index.css 主题变量一一对应
 *   - 默认跟随系统 prefers-color-scheme
 *   - 用户选择持久化到 localStorage
 * 使用场景：
 *   - 编程式获取当前主题下的颜色（用于 ECharts/Canvas 等无法用 Tailwind 的场景）
 *   - 主题切换 UI
 * 依赖：designTokens.ts（值）+ designTokens.types.ts（类型）
 * ============================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  colors as baseColors,
  semanticColors as baseSemantic,
} from '../utils/designTokens';
import type { ThemeName, ThemeMap } from '../utils/designTokens.types';

const STORAGE_KEY = 'hermes.theme';
const DEFAULT_THEME: ThemeName = 'dark';

/**
 * 主题映射 - 浅色/高对比度变体
 * 暗色为基线，其他主题只覆盖需要变化的 token
 */
const themeMap: ThemeMap = {
  dark: {
    colors: baseColors,
  },
  light: {
    colors: {
      hermes: baseColors.hermes,
      surface: {
        50: '#ffffff',
        100: '#f8f8fa',
        200: '#f0f0f4',
        300: '#e5e5ea',
        400: '#d4d4dc',
        500: '#a3a3b0',
        600: '#737380',
        700: '#525260',
        800: '#3a3a45',
        900: '#222230',
        950: '#0a0a14',
      },
      semantic: baseColors.semantic,
    },
  },
  'high-contrast': {
    colors: {
      hermes: {
        ...baseColors.hermes,
        500: '#ffb84d',
        600: '#ff9a1a',
      },
      surface: {
        50: '#000000',
        100: '#0a0a0a',
        200: '#141414',
        300: '#1e1e1e',
        400: '#282828',
        500: '#3a3a3a',
        600: '#525252',
        700: '#6a6a6a',
        800: '#828282',
        900: '#9a9a9a',
        950: '#b2b2b2',
      },
      semantic: baseColors.semantic,
    },
  },
};

/**
 * 从 localStorage 读取主题，缺失则回退到系统偏好
 */
function detectInitialTheme(): ThemeName {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (saved && ['dark', 'light', 'high-contrast'].includes(saved)) {
      return saved;
    }
  } catch {
    // 忽略 localStorage 异常（隐私模式等）
  }
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return DEFAULT_THEME;
}

/**
 * 浅色主题下的语义色（文字/背景反转）
 */
const lightSemantic = {
  bgPrimary: '#ffffff',
  bgSecondary: '#f8f8fa',
  bgTertiary: '#f0f0f4',
  textPrimary: '#0a0a0a',
  textSecondary: '#525260',
  textTertiary: '#737380',
  border: 'rgba(0,0,0,0.08)',
  borderHover: 'rgba(240,160,48,0.6)',
  accent: baseColors.hermes[500],
  accentHover: baseColors.hermes[400],
};

export interface UseDesignTokensResult {
  /** 当前主题名 */
  theme: ThemeName;
  /** 当前主题下的颜色 token */
  colors: typeof baseColors;
  /** 当前主题下的语义色 */
  semantic: typeof baseSemantic;
  /** 切换主题 */
  setTheme: (theme: ThemeName) => void;
  /** 切换到下一个主题（dark → light → high-contrast → dark） */
  cycleTheme: () => void;
  /** 是否深色主题 */
  isDark: boolean;
}

const THEME_CYCLE: ThemeName[] = ['dark', 'light', 'high-contrast'];

/**
 * useDesignTokens - 主题切换 + token 派生
 */
export function useDesignTokens(): UseDesignTokensResult {
  const [theme, setThemeState] = useState<ThemeName>(detectInitialTheme);

  // 同步 data-theme 到 <html>，便于 CSS 选择器命中
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // 同步到 localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 忽略写入异常
    }
  }, [theme]);

  // 监听系统主题变化（仅在用户未显式选择时响应）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (!saved) {
          setThemeState(e.matches ? 'light' : 'dark');
        }
      } catch {
        // 忽略
      }
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const setTheme = useCallback((next: ThemeName) => {
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const idx = THEME_CYCLE.indexOf(prev);
      return THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    });
  }, []);

  const isDark = theme === 'dark' || theme === 'high-contrast';

  return useMemo<UseDesignTokensResult>(
    () => ({
      theme,
      colors: themeMap[theme]?.colors ?? baseColors,
      semantic: theme === 'light' ? lightSemantic : baseSemantic,
      setTheme,
      cycleTheme,
      isDark,
    }),
    [theme, setTheme, cycleTheme, isDark]
  );
}

export default useDesignTokens;
