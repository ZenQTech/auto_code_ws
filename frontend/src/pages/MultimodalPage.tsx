/**
 * # ============================================================
 * # MultimodalPage - 多模态独立页面
 * # ============================================================
 * 独立路由 /multimodal 的页面容器
 * 复用 MultiModalPanel 组件 (v6.99.0 Cycle 36 G36-03)
 */

import React from 'react';
import MultiModalPanel from '../components/MultiModalPanel';

export const MultimodalPage: React.FC = () => {
  return (
    <div className="h-screen w-screen flex flex-col bg-gradient-to-br from-violet-50 to-fuchsia-50">
      <div className="flex-1 p-4 overflow-hidden">
        <div className="h-full max-w-6xl mx-auto">
          <MultiModalPanel isOpen={true} onClose={() => {}} />
        </div>
      </div>
    </div>
  );
};

export default MultimodalPage;
