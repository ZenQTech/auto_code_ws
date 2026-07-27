/**
 * # ============================================================
 * RootLayout - 根布局 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：根布局组件,所有路由的父级
 *           包含全局 Provider (Toast/Modals) + Outlet
 * 运行流程：
 *   1. 渲染全局 Providers (ErrorBoundary/Toast)
 *   2. Outlet 渲染匹配的子路由
 * 输入参数：无
 * 输出结果：根布局 JSX
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';
import { Outlet } from 'react-router-dom';

import ErrorBoundary from '../components/ErrorBoundary';

const RootLayout: React.FC = () => {
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-surface-50/30">
        <Outlet />
      </div>
    </ErrorBoundary>
  );
};

export default RootLayout;
