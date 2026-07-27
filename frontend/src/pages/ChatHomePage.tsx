/**
 * # ============================================================
 * ChatHomePage - 聊天首页 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：聊天模式首页,显示欢迎信息和提示词
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';
import { Link } from 'react-router-dom';

const ChatHomePage: React.FC = () => {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">💬</div>
        <h1 className="text-2xl font-bold text-surface-800 mb-2">开始一段对话</h1>
        <p className="text-sm text-surface-500 mb-6">
          从侧边栏选择历史会话,或创建新对话
        </p>
        <Link
          to="/chat/new"
          className="inline-flex items-center gap-2 px-4 py-2
                     bg-hermes-500 text-white rounded-md
                     hover:bg-hermes-600 transition-colors text-sm font-medium"
        >
          ✨ 新建对话
        </Link>
      </div>
    </div>
  );
};

export default ChatHomePage;
