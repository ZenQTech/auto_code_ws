/**
 * # ============================================================
 * ProjectWorkspacePage - 项目工作区 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：特定项目的工作区页面
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 * ============================================================
 */

import React from 'react';
import { useParams, Link } from 'react-router-dom';

import type { CodingProjectParams } from '../router/types';

const ProjectWorkspacePage: React.FC = () => {
  const { projectId } = useParams<CodingProjectParams>();

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="text-center max-w-md">
        <div className="text-5xl mb-4">💻</div>
        <h1 className="text-2xl font-bold text-surface-800 mb-2">
          项目 {projectId}
        </h1>
        <p className="text-sm text-surface-500 mb-6">
          路由参数 :projectId = <code className="text-hermes-600">{projectId}</code>
        </p>
        <p className="text-xs text-surface-400 mb-6">
          注: 完整的 ProjectWorkspace 由 App.tsx 接管
        </p>
        <Link
          to="/coding/home"
          className="inline-flex items-center gap-2 px-4 py-2
                     bg-hermes-500 text-white rounded-md
                     hover:bg-hermes-600 transition-colors text-sm font-medium"
        >
          返回项目选择
        </Link>
      </div>
    </div>
  );
};

export default ProjectWorkspacePage;
