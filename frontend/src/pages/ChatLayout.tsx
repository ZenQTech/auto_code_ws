/**
 * # ============================================================
 * ChatLayout - 聊天布局 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：聊天模式父布局,包含 Sidebar + 主内容区
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';
import { Outlet } from 'react-router-dom';

const ChatLayout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-surface-50/30">
      <Outlet />
    </div>
  );
};

export default ChatLayout;
