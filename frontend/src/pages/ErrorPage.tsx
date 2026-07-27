/**
 * # ============================================================
 * ErrorPage - 路由错误页 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：路由未匹配或渲染错误时显示
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 # 兼容：react-router-dom v6.3 (无 useRouteError)
 # ============================================================
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const ErrorPage: React.FC = () => {
  const location = useLocation();
  const isNotFound = location.pathname !== '/';

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50/30 p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
        <div className="text-7xl mb-4">😵</div>
        <h1 className="text-2xl font-bold text-surface-800 mb-2">
          {isNotFound ? '页面未找到' : '出错了'}
        </h1>
        <p className="text-sm text-surface-500 mb-6">
          {isNotFound
            ? `路径 "${location.pathname}" 不存在`
            : '发生未知错误,请稍后重试'}
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link
            to="/"
            className="px-4 py-2 bg-hermes-500 text-white rounded-md
                       hover:bg-hermes-600 transition-colors text-sm font-medium"
          >
            回到首页
          </Link>
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2 bg-surface-100 text-surface-700 rounded-md
                       hover:bg-surface-200 transition-colors text-sm font-medium"
          >
            返回上一页
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorPage;
