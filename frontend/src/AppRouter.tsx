/**
 * # ============================================================
 * AppRouter.tsx - 顶层路由组件（v1.1.0 P0-5 启用）
 * # ============================================================
 * 核心作用：定义应用顶层路由（/、/chat、/coding、/settings、/workflow/:id），
 *           用 BrowserRouter 包裹；当前阶段使用占位组件，
 *           后续 Module 阶段逐步将各页面从 App.tsx 迁移过来
 * 运行流程：
 *   1. 启动时根据 URL 路径匹配到对应占位组件
 *   2. /              → HomePage
 *   3. /chat          → ChatPage（占位）
 *   4. /coding        → CodingPage（占位）
 *   5. /settings      → SettingsPage（占位）
 *   6. /workflow/:id  → WorkflowDetailPage（占位，:id 通过 useParams 取）
 * 输入参数：无
 * 输出结果：渲染当前路由对应的占位组件
 * 修改记录：
 *   - 2026-07-24 | v1.0.0 | Module F3 初始版本：定义 5 个路由占位组件 + AppRouter
 *   - 2026-07-27 | v1.1.0 | P0-5 启用 react-router-dom：取消 import 注释，
 *     启用 BrowserRouter + Routes 完整路由树，使用 useParams 取动态参数
 * ============================================================
 */

import React from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';

// ============================================================
// 占位组件（每个路由一个）
// ============================================================

/**
 * HomePage - 根路由占位
 * 当前显示 App.tsx 内容（main.tsx 中仍以 App 作为根组件渲染）
 */
export const HomePage: React.FC = () => {
  return (
    <div data-route="home" style={{ padding: 24 }}>
      <h1>Home</h1>
      <p>根路由占位（当前 App.tsx 仍为根组件）</p>
    </div>
  );
};

/**
 * ChatPage - 聊天页占位
 */
export const ChatPage: React.FC = () => {
  return (
    <div data-route="chat" style={{ padding: 24 }}>
      <h1>Chat</h1>
      <p>聊天路由占位（后续将 App.tsx 中的对话视图迁移到此）</p>
    </div>
  );
};

/**
 * CodingPage - 编程页占位
 */
export const CodingPage: React.FC = () => {
  return (
    <div data-route="coding" style={{ padding: 24 }}>
      <h1>Coding</h1>
      <p>编程路由占位（后续将编程模式相关视图迁移到此）</p>
    </div>
  );
};

/**
 * SettingsPage - 设置页占位
 */
export const SettingsPage: React.FC = () => {
  return (
    <div data-route="settings" style={{ padding: 24 }}>
      <h1>Settings</h1>
      <p>设置路由占位（后续将 SettingsPanel 迁移到此）</p>
    </div>
  );
};

/**
 * WorkflowDetailPage - 工作流详情页占位
 * 路径参数 :id 通过 useParams 取
 */
export const WorkflowDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <div data-route="workflow" data-id={id} style={{ padding: 24 }}>
      <h1>Workflow Detail</h1>
      <p>工作流详情路由占位，id = {id}</p>
    </div>
  );
};

// ============================================================
// AppRouter 组件
// ============================================================

/**
 * AppRouter - 顶层路由组件
 * v1.1.0 启用 react-router-dom：返回 BrowserRouter + Routes 树
 */
export const AppRouter: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/coding" element={<CodingPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/workflow/:id" element={<WorkflowDetailPage />} />
        {/* 通配符回退：未匹配路由跳到首页 */}
        <Route path="*" element={<HomePage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default AppRouter;
