/**
 * # ============================================================
 * CodingHomePage - 编程首页 (v1.0.1) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：编程模式首页,显示新建/打开项目选项
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 *   - 2026-08-03 | v1.0.1 | G60-FIX-16 修复主题感知：bg-white 替换为 var(--bg-panel)
 * ====================================
 */

import React from 'react';
import { Link } from 'react-router-dom';

const CodingHomePage: React.FC = () => {
  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">⚡</div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-1">选择项目</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            新建一个编程项目,或打开已有项目开始工作
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            to="/coding/new"
            className="group bg-[var(--bg-panel)] border-2 border-surface-200 rounded-2xl p-6
                       hover:border-hermes-400 hover:shadow-lg transition-all"
          >
            <div className="text-3xl mb-3">📁</div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">新建项目</h2>
            <p className="text-sm text-[var(--text-secondary)]">创建一个空白编程项目</p>
          </Link>

          <Link
            to="/settings"
            className="group bg-[var(--bg-panel)] border-2 border-surface-200 rounded-2xl p-6
                       hover:border-hermes-400 hover:shadow-lg transition-all"
          >
            <div className="text-3xl mb-3">📂</div>
            <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">打开已有项目</h2>
            <p className="text-sm text-[var(--text-secondary)]">从工作空间中选择项目</p>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default CodingHomePage;
