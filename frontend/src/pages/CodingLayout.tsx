/**
 * # ============================================================
 * CodingLayout - 编程布局 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：编程模式父布局
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';
import { Outlet } from 'react-router-dom';

const CodingLayout: React.FC = () => {
  return (
    <div className="min-h-screen flex flex-col bg-surface-50/30">
      <Outlet />
    </div>
  );
};

export default CodingLayout;
