/**
 * # ============================================================
 * DiffView 独立访问页面 (v1.0.0 - Cycle 9 P1-7)
 * # ============================================================
 * 核心作用：为 DiffView 组件提供独立路由入口，
 *           便于 Phase 5 UI 优化阶段单独访问/截图/E2E 测试，
 *           同时保留对项目路径 URL 参数 (?project=/path) 的支持。
 * 运行流程：
 *   1. 解析 URL 中的 ?project=/path 参数
 *   2. 渲染 DiffView 主组件，传入 projectPath
 *   3. 提供返回主界面按钮
 * 输入参数（URL）：
 *   - project?: string  项目根目录绝对路径（可选）
 * 输出结果：独立的 DiffView 展示页面
 * 修改记录：
 *   - 2026-07-28 | v1.0.0 | 初始版本 - 支持独立 URL 访问 + 项目路径透传
 * ============================================================
 */

import { useSearchParams, useNavigate } from 'react-router-dom';
import DiffView from '../components/DiffView';

export default function DiffViewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const projectPath = params.get('project') || undefined;

  return (
    <div className="min-h-screen bg-surface-50 bg-noise p-4 flex flex-col">
      {/* 顶部返回栏 */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => navigate(-1)}
          className="px-3 py-1 text-xs font-medium rounded
                     bg-surface-200 hover:bg-surface-300
                     text-surface-700 border border-surface-300 transition-colors"
        >
          ← 返回
        </button>
        <h1 className="text-base font-semibold text-surface-900">DiffView（v2.0.0 多格式增强版）</h1>
        {projectPath && (
          <span className="text-xs text-surface-500 font-mono truncate">
            项目: {projectPath}
          </span>
        )}
      </div>
      {/* DiffView 主组件 */}
      <div className="flex-1 min-h-0">
        <DiffView projectPath={projectPath} />
      </div>
    </div>
  );
}
