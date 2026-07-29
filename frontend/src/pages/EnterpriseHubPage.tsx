/**
 * # ============================================================
 * EnterpriseHubPage - 企业级 Plugin Hub 独立页面 (v1.0.0 - Cycle 14 P0-3)
 * # ============================================================
 * 核心作用：在独立路由 /enterprise-hub 展示企业级 Plugin Hub 完整能力
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * 修改记录：
 *   - 2026-07-28 | v1.0.0 | 新建
 * ============================================================
 */

import React from 'react';
import EnterpriseHubPanel from '../components/EnterpriseHubPanel';

const EnterpriseHubPage: React.FC = () => {
  return (
    <div className="h-full w-full bg-gray-50">
      <EnterpriseHubPanel standalone />
    </div>
  );
};

export default EnterpriseHubPage;
