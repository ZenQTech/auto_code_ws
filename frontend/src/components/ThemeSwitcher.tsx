/**
 * # ============================================================
 * ThemeSwitcher - 主题切换器 (v1.0.0)
 * Cycle 60 G60-1.3
 * # ============================================================
 * 核心作用：在 Codex/Trae Solo 风格顶部导航栏提供 3 主题快速切换
 * 运行流程：
 *   1. 读取 useDesignTokens 获取当前 theme
 *   2. 渲染 3 个主题按钮（dark/light/high-contrast）
 *   3. 点击触发 setTheme，data-theme 同步到 <html>
 *   4. 切换后通过 CSS 变量实现 < 300ms 平滑过渡
 * 设计要点：
 *   - 内联 SVG 图标（无第三方依赖，0 bundle 增长）
 *   - 当前主题高亮（金橙背景）
 *   - 持久化到 localStorage（useDesignTokens 已实现）
 *   - 支持快捷键 cycleTheme
 * 输入参数：无
 * 输出结果：3 按钮主题切换器
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-1.3 初次创建
 * ============================================================
 */

import React from 'react';

import { useDesignTokens, type ThemeName } from '../hooks/useDesignTokens';

// ============================================================
// 内联 SVG 图标（避免引入 lucide-react 等第三方库）
// ============================================================

const SunIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const MoonIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const ContrastIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2v20" />
    <path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor" />
  </svg>
);

// ============================================================
// 常量
// ============================================================

const THEME_CYCLE: ThemeName[] = ['dark', 'light', 'high-contrast'];

const THEME_META: Record<ThemeName, { icon: React.FC<{ className?: string }>; label: string; testid: string }> = {
  dark: { icon: MoonIcon, label: '深色', testid: 'theme-dark' },
  light: { icon: SunIcon, label: '浅色', testid: 'theme-light' },
  'high-contrast': { icon: ContrastIcon, label: '高对比度', testid: 'theme-high-contrast' },
};

// ============================================================
// 组件
// ============================================================

export const ThemeSwitcher: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { theme, setTheme, cycleTheme } = useDesignTokens();

  return (
    <div
      className={[
        'flex items-center gap-0.5 p-0.5 rounded-lg',
        'bg-[var(--bg-panel)] border border-[var(--border-color)]',
        className,
      ].join(' ')}
      data-testid="theme-switcher"
      role="group"
      aria-label="主题切换"
    >
      {THEME_CYCLE.map((t) => {
        const meta = THEME_META[t];
        const Icon = meta.icon;
        const isActive = theme === t;
        return (
          <button
            key={t}
            type="button"
            onClick={() => setTheme(t)}
            className={[
              'p-1.5 rounded-md transition-all duration-150 ease-material',
              'focus:outline-none focus:ring-2 focus:ring-hermes-500',
              isActive
                ? 'bg-hermes-500 text-white shadow-sm'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]',
            ].join(' ')}
            aria-label={`切换到 ${meta.label} 主题`}
            aria-pressed={isActive}
            data-testid={meta.testid}
            title={meta.label}
          >
            <Icon className="w-4 h-4" />
          </button>
        );
      })}
      {/* 隐藏的 cycle 按钮（供快捷键使用） */}
      <button
        type="button"
        onClick={cycleTheme}
        className="sr-only"
        aria-label="循环切换主题"
        data-testid="theme-cycle"
      >
        cycle
      </button>
    </div>
  );
};

export default ThemeSwitcher;
