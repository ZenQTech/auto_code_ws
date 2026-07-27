/**
 * # ============================================================
 * # 应用入口文件 main.tsx
 * # ============================================================
 * # 核心作用：React 应用启动入口，负责将根组件挂载到 DOM
 * # 运行流程：
 * #   1. 创建 React 根实例（基于 #root 元素）
 * #   2. 在 StrictMode 下渲染 ErrorBoundary 包裹的 App 组件
 * #   3. ErrorBoundary 捕获子组件树渲染错误，防止整个应用白屏
 * # 输入参数：无（应用启动时由 main.tsx 加载）
 * # 输出结果：渲染到页面的完整应用
 * # 修改记录：
 * #   - 2026-06-25 | v1.0.0 | 初始创建：React.StrictMode 包裹 App
 * #   - 2026-07-24 | v1.1.0 | 集成 ErrorBoundary 包裹 App
 * #     防止任意子组件抛错导致整个应用白屏崩溃，提升应用健壮性
 * # ============================================================
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
