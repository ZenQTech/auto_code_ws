/**
 * # ============================================================
 * # 应用入口文件 main.tsx
 * # ============================================================
 * # 核心作用：React 应用启动入口，负责将根组件挂载到 DOM
 * # 运行流程：
 * #   1. 提前加载 Monaco Editor 主包（与 vite manualChunks vendor-monaco 配合）
 * #      保持首屏 3MB 以内（不含 workers），workers 按需懒加载
 * #   2. 加载 monacoWorkers 配置（workers 按需懒加载，节省 7MB 初始下载）
 * #   3. 创建 React 根实例（基于 #root 元素）
 * #   4. 在 StrictMode 下渲染 ErrorBoundary 包裹的 AppStateProvider
 * #      + RouterProvider（v1.4.0 Cycle 15 P1-1 新增）
 * #   5. AppStateProvider 提供全局状态（useReducer + Context）
 * #      启用 React Router v6 SPA 模式 (Cycle 7 P1-2)
 * #   6. ErrorBoundary 捕获子组件树渲染错误，防止整个应用白屏
 * #   7. v1.5.0 Cycle 18 P0-3：安装 GlobalErrorHandler 监听 window.onerror /
 * #      unhandledrejection / 资源加载失败等全局错误
 * # 输入参数：无（应用启动时由 main.tsx 加载）
 * # 输出结果：渲染到页面的完整应用
 * # 修改记录：
 * #   - 2026-06-25 | v1.0.0 | 初始创建：React.StrictMode 包裹 App
 * #   - 2026-07-24 | v1.1.0 | 集成 ErrorBoundary 包裹 App
 * #     防止任意子组件抛错导致整个应用白屏崩溃，提升应用健壮性
 * #   - 2026-07-27 | v1.2.0 | Cycle 7 P1-2 启用 RouterProvider
 * #     使用 createBrowserRouter 实现 SPA 路由模式
 * #   - 2026-07-29 | v1.3.0 | Cycle 15 P0-5 Monaco 主包预加载 + workers 懒加载
 * #   - 2026-07-29 | v1.4.0 | Cycle 15 P1-1 集成 AppStateProvider
 * #     在根级别引入 useReducer + Context 状态管理
 * #   - 2026-07-29 | v1.5.0 | Cycle 18 P0-3 安装 GlobalErrorHandler
 * #     监听 window.onerror / unhandledrejection / 资源加载错误，
 * #     统一收集并通过 GlobalErrorToast 提示用户
 * # ============================================================
 */

// 提前加载 Monaco 主包（与 vite.config.ts vendor-monaco 配合，单独 chunk）
import '@monaco-editor/react';
// 加载 workers 懒加载配置
import './config/monacoWorkers';

import React from 'react';
import ReactDOM from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary';
import AppRouter from './router/router';
import { AppStateProvider } from './providers/AppStateProvider';
/** v1.5.0 Cycle 18 P0-3：安装全局错误处理器 */
import { globalErrorHandler } from './utils/globalErrorHandler';
import './index.css';

// 在应用启动前安装全局错误监听器
// - 捕获 window.onerror（JS 同步错误）
// - 捕获 unhandledrejection（Promise 拒绝）
// - 捕获 script/img/css 资源加载失败
// - 静默 ResizeObserver loop 错误（已知浏览器警告，非致命）
globalErrorHandler.install({
  logToConsole: import.meta.env.DEV,
  maxReports: 50,
  dedupeWindowMs: 1000,
  silentPatterns: [
    /ResizeObserver loop/i,         // 浏览器 ResizeObserver 已知警告
    /Loading chunk \d+ failed/i,    // 路由懒加载失败（由 ErrorBoundary 接管）
    /NetworkError when attempting to fetch resource/i, // 离线检测由专门模块处理
  ],
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppStateProvider>
        <AppRouter />
      </AppStateProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
