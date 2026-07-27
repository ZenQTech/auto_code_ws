/**
 * # ============================================================
 * ModeSelectorPage - 模式选择页 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：根路由页面,显示 chat/coding 模式选择
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建 - 提取自 App.tsx
 * ============================================================
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';

import { useModals } from '../hooks/useModals';

const ModeSelectorPage: React.FC = () => {
  const navigate = useNavigate();
  // 占位以保持与 App.tsx 兼容,后续可清理
  useModals();

  const handleSelectMode = (mode: 'chat' | 'coding') => {
    navigate(`/${mode}/new`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br
                    from-surface-50 via-white to-hermes-50/30 p-4">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-4
                          rounded-full bg-gradient-to-br from-hermes-400 to-hermes-600
                          shadow-lg shadow-hermes-500/30">
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-3xl font-bold text-surface-800 mb-2">
            欢迎使用 Hermes 智能调度平台
          </h1>
          <p className="text-base text-surface-500">请选择您的工作模式</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => handleSelectMode('chat')}
            className="group bg-white border-2 border-surface-200 rounded-2xl p-6
                       text-left hover:border-hermes-400 hover:shadow-lg
                       transition-all duration-200"
          >
            <div className="text-3xl mb-3">💬</div>
            <h2 className="text-lg font-semibold text-surface-800 mb-1">日常办公闲聊模式</h2>
            <p className="text-sm text-surface-500">
              日常对话、翻译、总结、问答等通用办公场景,简单快捷的 AI 助手体验
            </p>
          </button>

          <button
            onClick={() => handleSelectMode('coding')}
            className="group bg-white border-2 border-surface-200 rounded-2xl p-6
                       text-left hover:border-hermes-400 hover:shadow-lg
                       transition-all duration-200"
          >
            <div className="text-3xl mb-3">⚡</div>
            <h2 className="text-lg font-semibold text-surface-800 mb-1">编程模式</h2>
            <p className="text-sm text-surface-500">
              提示词优化、任务规划、代码生成与调度,面向专业开发的全链路编程工作台
            </p>
          </button>
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/settings')}
            className="text-sm text-surface-500 hover:text-hermes-600 transition-colors"
          >
            前往设置 →
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModeSelectorPage;
