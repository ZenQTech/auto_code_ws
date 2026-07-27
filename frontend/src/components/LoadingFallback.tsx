/**
 * # ============================================================
 * LoadingFallback - 懒加载占位组件
 * # ============================================================
 * 核心作用：路由懒加载时显示的 loading 状态
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';

const LoadingFallback: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-screen bg-surface-50/30">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-hermes-200 border-t-hermes-500
                        rounded-full animate-spin" />
        <p className="text-sm text-surface-500">加载中...</p>
      </div>
    </div>
  );
};

export default LoadingFallback;
