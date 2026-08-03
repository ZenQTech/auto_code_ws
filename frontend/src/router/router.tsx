/**
 * # ============================================================
 * React Router v6 SPA Mode 路由配置 (v1.2.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：使用 BrowserRouter + Routes 实现 SPA 路由
 *           支持嵌套布局、懒加载、错误边界、类型安全参数
 * 运行流程：
 *   1. 用户访问 URL → 匹配路由树
 *   2. 父布局 (RootLayout) 渲染 → Outlet 显示子路由
 *   3. 子路由组件懒加载 → 减少首屏 bundle
 #   4. 默认 / 路由渲染 App 主界面（包含所有现有功能）
 # 输入参数：无
 # 输出结果：AppRouter 可消费的路由树
* # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建 - SPA 路由配置
 * #   - 2026-07-27 | v1.1.0 | 集成 App.tsx 主界面作为默认路由
 * #   - 2026-07-27 | v1.2.0 | 清理未使用的页面 import（App.tsx 统一渲染）
 * #   - 2026-08-03 | v1.3.0 | Cycle 58 G58-01 新增 /vibe-coding 路由
 * # 兼容：react-router-dom@^6.3.0 (JSX 路由模式)
 # ============================================================
 */

import React, { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import RootLayout from '../pages/RootLayout';
import LoadingFallback from '../components/LoadingFallback';
import App from '../App';

// ============================================================
// 懒加载页面组件 (按需加载,减小首屏 bundle)
// ============================================================
// 独立页面：设置、工作流、模式选择、聊天/编程首页
const ModeSelectorPage = lazy(() => import('../pages/ModeSelectorPage'));
const ChatHomePage = lazy(() => import('../pages/ChatHomePage'));
const CodingHomePage = lazy(() => import('../pages/CodingHomePage'));
const SettingsPage = lazy(() => import('../pages/SettingsPage'));
const WorkflowDetailPage = lazy(() => import('../pages/WorkflowDetailPage'));
// v1.0.0 (Cycle 9 P1-7) 新增：DiffView 独立访问页面（支持 ?project=/path 参数）
const DiffViewPage = lazy(() => import('../pages/DiffViewPage'));
// v1.0.0 (Cycle 10 P1-8) 新增：Memory System 独立访问页面
const MemoryPage = lazy(() => import('../pages/MemoryPage'));
// v1.0.0 (Cycle 10 P1-10) 新增：Verification Loop 独立访问页面
const VerificationPage = lazy(() => import('../pages/VerificationPage'));
// v1.0.0 (Cycle 11 P2-2) 新增：Doctor 环境诊断系统独立访问页面
const DoctorPage = lazy(() => import('../pages/DoctorPage'));
// v1.0.0 (Cycle 13 P1-2) 新增：LLM-as-Judge 验证层独立访问页面
const LlmJudgePage = lazy(() => import('../pages/LlmJudgePage'));
// v1.0.0 (Cycle 13 P1-3) 新增：Plugin Marketplace 独立访问页面
const MarketplacePage = lazy(() => import('../pages/MarketplacePage'));

// v1.0.0 (Cycle 14 P0-2) 新增：多模态支持独立访问页面
const MultimodalPage = lazy(() => import('../pages/MultimodalPage'));

// v1.0.0 (Cycle 14 P0-3) 新增：企业级 Plugin Hub 独立访问页面
const EnterpriseHubPage = lazy(() => import('../pages/EnterpriseHubPage'));

// v1.0.0 (Cycle 14 P1-3) 新增：TRAE Work 多模态协作独立访问页面
const TraeWorkPage = lazy(() => import('../pages/TraeWorkPage'));

// v1.0.0 (Cycle 14 P1-4) 新增：Goal Automation 自动轮转 + 多 Agent 委派独立访问页面
const GoalAutomationPage = lazy(() => import('../pages/GoalAutomationPage'));

// v1.0.0 (Cycle 14 P1-5) 新增：Goal Templates 模板库独立访问页面
const GoalTemplatesPage = lazy(() => import('../pages/GoalTemplatesPage'));

// v1.0.0 (Cycle 58 G58-01) 新增：Vibe Coding 模式主页面
const VibeCodingPage = lazy(() => import('../pages/VibeCodingPage'));

// v1.0.0 (Cycle 60 G60-2.3) 新增：Solo 模式主壳（对标 Codex/Trae Solo）
const VibeSoloShell = lazy(() => import('../pages/VibeSoloShell'));

// ============================================================
// Suspense 包装器: 懒加载页面统一显示 loading
// ============================================================
const lazyPage = (LazyComponent: React.LazyExoticComponent<React.ComponentType<any>>) => (
  <Suspense fallback={<LoadingFallback />}>
    <LazyComponent />
  </Suspense>
);

/**
 * AppRouter - 顶层路由组件 (兼容 react-router-dom v6.3)
 * v1.2.0: 默认路由 / 渲染 App.tsx（包含所有现有功能）
 *         App.tsx 内部通过 useLocation + useParams 同步 URL
 */
export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* 根布局 */}
        <Route path="/" element={<RootLayout />}>
          {/* 默认 / 路由 → App 主界面 (包含聊天/编程模式 + ModeSelector) */}
          <Route index element={<App />} />

          {/* 聊天路由 → 渲染 App（URL 包含模式信息） */}
          <Route path="chat" element={<App />}>
            <Route index element={<Navigate to="new" replace />} />
            <Route path="new" element={<App />} />
            <Route path="session/:sessionId" element={<App />} />
            <Route path="home" element={lazyPage(ChatHomePage)} />
          </Route>

          {/* 编程路由 → 渲染 App */}
          <Route path="coding" element={<App />}>
            <Route index element={lazyPage(CodingHomePage)} />
            <Route path="new" element={<App />} />
            <Route path="project/:projectId" element={<App />} />
          </Route>

          {/* 设置 & 工作流 - 独立页面 */}
          <Route path="settings" element={lazyPage(SettingsPage)} />
          <Route path="workflow/:workflowId" element={lazyPage(WorkflowDetailPage)} />
          {/* v1.0.0 (Cycle 9 P1-7) 新增：DiffView 独立访问路由
              支持 ?project=/path 参数直接打开指定项目的 diff 视图 */}
          <Route path="diff-view" element={lazyPage(DiffViewPage)} />
          {/* v1.0.0 (Cycle 10 P1-8) 新增：Memory System 独立访问路由 */}
          <Route path="memory" element={lazyPage(MemoryPage)} />
          {/* v1.0.0 (Cycle 10 P1-10) 新增：Verification Loop 独立访问路由 */}
          <Route path="verification" element={lazyPage(VerificationPage)} />
          {/* v1.0.0 (Cycle 11 P2-2) 新增：Doctor 环境诊断系统独立访问路由 */}
          <Route path="doctor" element={lazyPage(DoctorPage)} />
          {/* v1.0.0 (Cycle 13 P1-2) 新增：LLM-as-Judge 验证层独立访问路由 */}
          <Route path="llm-judge" element={lazyPage(LlmJudgePage)} />
          {/* v1.0.0 (Cycle 13 P1-3) 新增：Plugin Marketplace 独立访问路由 */}
          <Route path="marketplace" element={lazyPage(MarketplacePage)} />
          {/* v1.0.0 (Cycle 14 P0-2) 新增：多模态支持独立访问路由 */}
          <Route path="multimodal" element={lazyPage(MultimodalPage)} />
          {/* v1.0.0 (Cycle 14 P0-3) 新增：企业级 Plugin Hub 独立访问路由 */}
          <Route path="enterprise-hub" element={lazyPage(EnterpriseHubPage)} />
          {/* v1.0.0 (Cycle 14 P1-3) 新增：TRAE Work 多模态协作独立访问路由 */}
          <Route path="work" element={lazyPage(TraeWorkPage)} />
          {/* v1.0.0 (Cycle 14 P1-4) 新增：Goal Automation 独立访问路由 */}
          <Route path="goal-automation" element={lazyPage(GoalAutomationPage)} />
          {/* v1.0.0 (Cycle 14 P1-5) 新增：Goal Templates 模板库独立访问路由 */}
          <Route path="goal-templates" element={lazyPage(GoalTemplatesPage)} />

          {/* v1.0.0 (Cycle 58 G58-01) 新增：Vibe Coding 模式独立访问路由 */}
          <Route path="vibe-coding" element={lazyPage(VibeCodingPage)} />

          {/* v1.0.0 (Cycle 60 G60-2.3) 新增：Solo 模式主壳（对标 Codex/Trae Solo）
              完整三栏布局 + Goal 岛台 + 会话历史 + 工具矩阵 */}
          <Route path="solo" element={lazyPage(VibeSoloShell)} />

          {/* 模式选择 - 保留独立路由 */}
          <Route path="select-mode" element={lazyPage(ModeSelectorPage)} />

          {/* 兜底: 未匹配路由回到首页 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default AppRouter;
