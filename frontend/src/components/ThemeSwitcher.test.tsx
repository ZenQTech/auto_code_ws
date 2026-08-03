/**
 * # ============================================================
 * ThemeSwitcher.test.tsx - 主题切换器单元测试
 * Cycle 60 G60-1.3
 * # ============================================================
 * 核心作用：验证 3 主题切换 + data-theme 同步
 * 工具：vitest + happy-dom
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-1.3 初次创建
 * ============================================================
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { ThemeSwitcher } from './ThemeSwitcher';
import * as useDesignTokensModule from '../hooks/useDesignTokens';

// mock useDesignTokens
vi.mock('../hooks/useDesignTokens', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useDesignTokens: vi.fn(() => ({
      theme: 'dark',
      setTheme: vi.fn(),
      cycleTheme: vi.fn(),
      isDark: true,
    })),
  };
});

describe('ThemeSwitcher 组件', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'dark';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('G60-1.3-TS-01: 渲染 3 个主题按钮', () => {
    render(<ThemeSwitcher />);
    expect(screen.getByTestId('theme-dark')).toBeDefined();
    expect(screen.getByTestId('theme-light')).toBeDefined();
    expect(screen.getByTestId('theme-high-contrast')).toBeDefined();
  });

  test('G60-1.3-TS-02: 点击 dark 按钮调用 setTheme', () => {
    const setTheme = vi.fn();
    (useDesignTokensModule.useDesignTokens as any).mockReturnValue({
      theme: 'light',
      setTheme,
      cycleTheme: vi.fn(),
      isDark: false,
    });
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByTestId('theme-dark'));
    expect(setTheme).toHaveBeenCalledWith('dark');
  });

  test('G60-1.3-TS-03: 当前主题按钮高亮', () => {
    (useDesignTokensModule.useDesignTokens as any).mockReturnValue({
      theme: 'high-contrast',
      setTheme: vi.fn(),
      cycleTheme: vi.fn(),
      isDark: true,
    });
    render(<ThemeSwitcher />);
    const btn = screen.getByTestId('theme-high-contrast');
    expect(btn.className).toContain('bg-hermes-500');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  test('G60-1.3-TS-04: 隐藏的 cycle 按钮可点击', () => {
    const cycleTheme = vi.fn();
    (useDesignTokensModule.useDesignTokens as any).mockReturnValue({
      theme: 'dark',
      setTheme: vi.fn(),
      cycleTheme,
      isDark: true,
    });
    render(<ThemeSwitcher />);
    fireEvent.click(screen.getByTestId('theme-cycle'));
    expect(cycleTheme).toHaveBeenCalled();
  });
});
