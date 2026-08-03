/**
 * # ============================================================
 * RootLayout - 根布局 (v1.2.0) - Cycle 7 P1-2 + G60-FIX-10/12
 * # ============================================================
 * 核心作用：根布局组件,所有路由的父级
 *           包含全局 Provider (Toast/Modals/ThemeBoot) + Outlet
 * 运行流程：
 *   1. 渲染全局 Providers (ErrorBoundary/Toast)
 *   2. ThemeBoot 启动 useDesignTokens，确保 data-theme 立即同步到 <html>
 *   3. Outlet 渲染匹配的子路由
 * 输入参数：无
 * 输出结果：根布局 JSX
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 *   - 2026-08-03 | v1.1.0 | G60-FIX-10 移除 bg-surface-50/30 硬编码，
 *                              改用 bg-[var(--bg-app)] 主题变量。
 *                              Tailwind surface 调色板是固定深色，不响应主题切换。
 *   - 2026-08-03 | v1.2.0 | G60-FIX-12 集成 ThemeBoot 启动 useDesignTokens，
 *                              让任何路由（即使不渲染 ThemeSwitcher / VibeSoloShell）
 *                              都能在挂载时立即同步 data-theme 到 <html>。
 * ============================================================
 */

import React from 'react';
import { Outlet } from 'react-router-dom';

import ErrorBoundary from '../components/ErrorBoundary';
import { useDesignTokens } from '../hooks/useDesignTokens';

/**
 * ThemeBoot - 启动时同步主题到 <html>
 * 核心作用：调用 useDesignTokens() 触发其 useEffect，
 *           将 data-theme 属性和 CSS 变量立即同步到 <html>。
 * 设计原则：
 *   - 必须在路由树最高层（RootLayout）挂载一次
 *   - 不渲染任何 UI（返回 null）
 *   - 不会影响布局（无 DOM 节点）
 */
const ThemeBoot: React.FC = () => {
  useDesignTokens();
  return null;
};

const RootLayout: React.FC = () => {
  return (
    <ErrorBoundary>
      <ThemeBoot />
      <div className="min-h-screen bg-[var(--bg-app)]">
        <Outlet />
      </div>
    </ErrorBoundary>
  );
};

export default RootLayout;
