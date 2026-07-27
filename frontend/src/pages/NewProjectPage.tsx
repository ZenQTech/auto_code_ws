/**
 * # ============================================================
 * NewProjectPage - 新建项目 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：新建编程项目占位页
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';

const NewProjectPage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">📁</div>
        <h1 className="text-2xl font-bold text-surface-800 mb-2">新建项目</h1>
        <p className="text-sm text-surface-500 mb-6">
          输入项目名称,创建一个新的编程项目
        </p>
        <button
          onClick={() => navigate('/coding/home')}
          className="px-4 py-2 bg-surface-100 text-surface-700 rounded-md
                     hover:bg-surface-200 transition-colors text-sm font-medium"
        >
          返回
        </button>
        <p className="mt-4 text-xs text-surface-400">
          注: 完整功能由 App.tsx 接管
        </p>
      </div>
    </div>
  );
};

export default NewProjectPage;
