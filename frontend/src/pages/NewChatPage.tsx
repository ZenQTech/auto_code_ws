/**
 * # ============================================================
 * NewChatPage - 新建聊天 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：新建聊天会话的占位页
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';

const NewChatPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">✨</div>
        <h1 className="text-2xl font-bold text-surface-800 mb-2">新建对话</h1>
        <p className="text-sm text-surface-500 mb-6">
          即将创建新会话...
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => navigate('/chat/home')}
            className="px-4 py-2 bg-surface-100 text-surface-700 rounded-md
                       hover:bg-surface-200 transition-colors text-sm font-medium"
          >
            返回
          </button>
          <button
            onClick={() => alert('完整功能由 App.tsx 接管,可通过 /chat/session/{id} 访问')}
            className="px-4 py-2 bg-hermes-500 text-white rounded-md
                       hover:bg-hermes-600 transition-colors text-sm font-medium"
          >
            创建会话
          </button>
        </div>
        <p className="mt-4 text-xs text-surface-400">
          注: 完整的聊天视图由 App.tsx 渲染,可通过路径 /chat/session/{'{id}'} 访问
        </p>
      </div>
    </div>
  );
};

export default NewChatPage;
