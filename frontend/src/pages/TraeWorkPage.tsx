/**
 * # ============================================================
 * # TraeWorkPage - TRAE Work 多模态协作独立页面
 * # ============================================================
 * 独立路由 /work 的页面容器
 * 复用 TraeWorkPanel 组件
 * 版本：v6.31.0 | Cycle 14 P1-3
 */

import React from 'react';
import TraeWorkPanel from '../components/TraeWorkPanel';

export const TraeWorkPage: React.FC = () => {
  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-pink-50 via-violet-50 to-orange-50">
      <div className="flex-1 p-4 overflow-hidden">
        <div className="h-full max-w-7xl mx-auto">
          <TraeWorkPanel />
        </div>
      </div>
    </div>
  );
};

export default TraeWorkPage;
