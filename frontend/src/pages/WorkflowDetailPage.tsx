/**
 * # ============================================================
 * WorkflowDetailPage - 工作流详情 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：特定工作流的详情页
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';
import { useParams, Link } from 'react-router-dom';

import type { WorkflowParams } from '../router/types';

const WorkflowDetailPage: React.FC = () => {
  const { workflowId } = useParams<WorkflowParams>();

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">🔄</div>
        <h1 className="text-2xl font-bold text-surface-800 mb-2">
          工作流 {workflowId}
        </h1>
        <p className="text-sm text-surface-500 mb-6">
          路由参数 :workflowId = <code className="text-hermes-600">{workflowId}</code>
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-2 px-4 py-2
                     bg-hermes-500 text-white rounded-md
                     hover:bg-hermes-600 transition-colors text-sm font-medium"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
};

export default WorkflowDetailPage;
