/**
 * # ============================================================
 * Design Tokens 单元测试（Cycle 15 P1-3）
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  colors,
  semanticColors,
  spacing,
  radius,
  shadows,
  easings,
  durations,
  zIndex,
  breakpoints,
  tokens,
  darken,
  lighten,
  withAlpha,
} from './designTokens';
import { useDesignTokens } from '../hooks/useDesignTokens';

describe('designTokens values', () => {
  it('hermes 500 = #f0a030', () => {
    expect(colors.hermes[500]).toBe('#f0a030');
  });
  it('surface 50 = #0a0a0f', () => {
    expect(colors.surface[50]).toBe('#0a0a0f');
  });
  it('semantic 颜色齐全', () => {
    expect(colors.semantic.success).toBeTruthy();
    expect(colors.semantic.error).toBeTruthy();
    expect(colors.semantic.warning).toBeTruthy();
    expect(colors.semantic.info).toBeTruthy();
  });
  it('spacing 覆盖 4px 网格', () => {
    expect(spacing[0]).toBe('0px');
    expect(spacing[1]).toBe('4px');
    expect(spacing[4]).toBe('16px');
    expect(spacing[8]).toBe('32px');
  });
  it('radius 阶梯完整', () => {
    expect(radius.xs).toBe('4px');
    expect(radius.full).toBe('9999px');
  });
  it('shadows 包含 Hermes glow', () => {
    expect(shadows['glow-hermes']).toContain('240,160,48');
  });
  it('easings 包含 4 种曲线', () => {
    expect(easings.material).toContain('cubic-bezier');
    expect(easings.spring).toContain('cubic-bezier');
  });
  it('durations 包含全部级别', () => {
    expect(durations.fast).toBe(150);
    expect(durations.slow).toBe(280);
  });
  it('zIndex toast = 1700', () => {
    expect(zIndex.toast).toBe(1700);
  });
  it('breakpoints 5 档', () => {
    expect(breakpoints.sm).toBe(640);
    expect(breakpoints['2xl']).toBe(1536);
  });
  it('tokens 聚合包含所有分项', () => {
    expect(tokens.colors).toBe(colors);
    expect(tokens.spacing).toBe(spacing);
  });
  it('semanticColors 默认派生自深色', () => {
    expect(semanticColors.bgPrimary).toBe(colors.surface[100]);
    expect(semanticColors.accent).toBe(colors.hermes[500]);
  });
});

describe('utility functions', () => {
  it('darken: #f0a030 加深 10%', () => {
    const result = darken('#f0a030', 0.1);
    const r = parseInt(result.slice(1, 3), 16);
    const g = parseInt(result.slice(3, 5), 16);
    const b = parseInt(result.slice(5, 7), 16);
    expect(r).toBeLessThan(0xf0);
    expect(g).toBeLessThan(0xa0);
    expect(b).toBeLessThan(0x30);
  });
  it('lighten: 变亮', () => {
    const result = lighten('#000000', 0.5);
    // 注：color += 255 * 0.5 = 127.5 ≈ 127 (#7f)
    expect(result).toBe('#7f7f7f');
  });
  it('withAlpha: 转 rgba', () => {
    expect(withAlpha('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
  });
  it('darken 非法输入原样返回', () => {
    expect(darken('not-hex')).toBe('not-hex');
  });
});

describe('useDesignTokens (P1-3)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('默认主题为 dark', () => {
    const { result } = renderHook(() => useDesignTokens());
    expect(result.current.theme).toBe('dark');
  });

  it('setTheme 切换并持久化', () => {
    const { result } = renderHook(() => useDesignTokens());
    act(() => {
      result.current.setTheme('light');
    });
    expect(result.current.theme).toBe('light');
    expect(window.localStorage.getItem('hermes.theme')).toBe('light');
  });

  it('从 localStorage 恢复主题', () => {
    window.localStorage.setItem('hermes.theme', 'high-contrast');
    const { result } = renderHook(() => useDesignTokens());
    expect(result.current.theme).toBe('high-contrast');
  });

  it('cycleTheme 按 dark → light → high-contrast → dark 循环', () => {
    const { result } = renderHook(() => useDesignTokens());
    expect(result.current.theme).toBe('dark');
    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('light');
    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('high-contrast');
    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('isDark 在 dark/high-contrast 时为 true', () => {
    const { result } = renderHook(() => useDesignTokens());
    expect(result.current.isDark).toBe(true);
    act(() => result.current.setTheme('light'));
    expect(result.current.isDark).toBe(false);
    act(() => result.current.setTheme('high-contrast'));
    expect(result.current.isDark).toBe(true);
  });

  it('浅色主题下 semantic.bgPrimary 反转为白色', () => {
    const { result } = renderHook(() => useDesignTokens());
    act(() => result.current.setTheme('light'));
    expect(result.current.semantic.bgPrimary).toBe('#ffffff');
  });

  it('data-theme 同步到 <html>', () => {
    const { result } = renderHook(() => useDesignTokens());
    act(() => result.current.setTheme('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
