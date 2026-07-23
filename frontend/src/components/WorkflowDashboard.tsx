/**
 * # ============================================================
 * # WorkflowDashboard 工作流仪表盘组件（v2.0.0 升级）
 * # ============================================================
 * # 核心作用：展示 Loop Engineering 工作流 6 阶段进度条
 * #           （需求澄清→架构设计→提示词工程→代码执行→质量评审→迭代闭环）
 * # 运行流程：
 * #   1. 接收 LoopWorkflowStatus 数据作为输入
 * #   2. 渲染横向步骤条，每阶段用图标和颜色表示状态
 * #   3. 阶段之间用连接线表示流转关系
 * #   4. 显示整体进度百分比条
 * #   5. 支持点击阶段查看详情
 * # 输入参数：
 * #   - workflow: LoopWorkflowStatus | null，工作流状态
 * #   - loading?: boolean，加载状态
 * #   - onStageClick?: (stageKey: string) => void，阶段点击回调
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建
 * #   - 2026-06-25 | v2.0.0 | 升级为 Loop Engineering 6 阶段工作流
 * # ============================================================
 */

import type { LoopWorkflowStatus, StageStatus } from '../types';

interface Props {
  workflow: LoopWorkflowStatus | null;
  loading?: boolean;
  onStageClick?: (stageKey: string) => void;
}

const stageStatusMap: Record<StageStatus, {
  bg: string;
  text: string;
  border: string;
  dot: string;
  line: string;
  icon: string;
}> = {
  pending:     { bg: 'bg-surface-200', text: 'text-surface-500', border: 'border-surface-400', dot: 'bg-surface-400', line: 'bg-surface-400', icon: '○' },
  in_progress: { bg: 'bg-hermes-500/20', text: 'text-hermes-400', border: 'border-hermes-500/30', dot: 'bg-hermes-400 animate-pulse', line: 'bg-hermes-400', icon: '◉' },
  completed:   { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', dot: 'bg-emerald-400', line: 'bg-emerald-400', icon: '✓' },
  failed:      { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', dot: 'bg-red-400', line: 'bg-red-400', icon: '✕' },
};

const stageStatusLabels: Record<StageStatus, string> = {
  pending: '等待中',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
};

export default function WorkflowDashboard({ workflow, loading, onStageClick }: Props) {
  if (loading) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="skeleton h-6 w-40 rounded mb-4" />
        <div className="skeleton h-3 w-full rounded-full mb-4" />
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="flex-1">
              <div className="skeleton h-8 w-8 rounded-full mx-auto mb-1" />
              <div className="skeleton h-3 w-full rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!workflow || !workflow.stages || workflow.stages.length === 0) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">🔄</span>
          <span>暂无工作流数据</span>
        </div>
      </div>
    );
  }

  const currentStageIdx = workflow.stages.findIndex(s => s.status === 'in_progress');

  return (
    <div className="glass rounded-xl p-5 animate-fade-in">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">Loop Engineering 工作流</h3>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-500">整体进度</span>
          <span className={`text-lg font-bold ${
            workflow.progress >= 80 ? 'text-emerald-400' :
            workflow.progress >= 50 ? 'text-hermes-400' :
            'text-surface-500'
          }`}>
            {Math.round(workflow.progress)}%
          </span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="w-full h-2 bg-surface-200 rounded-full overflow-hidden mb-6">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${
            workflow.progress >= 80 ? 'bg-emerald-400' :
            workflow.progress >= 50 ? 'bg-hermes-400' :
            'bg-surface-400'
          }`}
          style={{ width: `${Math.min(workflow.progress, 100)}%` }}
        />
      </div>

      {/* 6 阶段步骤条 */}
      <div className="flex items-start">
        {workflow.stages.map((stage, index) => {
          const statusStyle = stageStatusMap[stage.status];
          const isLast = index === workflow.stages.length - 1;

          return (
            <div key={stage.key} className="flex-1 flex items-start min-w-0">
              <div
                className="flex flex-col items-center flex-1 min-w-0 cursor-pointer"
                onClick={() => onStageClick?.(stage.key)}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                                ${statusStyle.bg} ${statusStyle.text} border-2 ${statusStyle.border}
                                transition-all duration-300 hover:scale-110`}>
                  {statusStyle.icon}
                </div>

                <span className={`text-xs font-medium mt-1.5 text-center leading-tight px-1 ${
                  index === currentStageIdx ? 'text-hermes-400' : 'text-surface-600'
                }`}>
                  {stage.name}
                </span>

                <span className={`text-xs mt-0.5 ${statusStyle.text}`}>
                  {stageStatusLabels[stage.status]}
                </span>

                {stage.agent_role && (
                  <span className="text-xs text-surface-500 mt-0.5 truncate max-w-full">
                    {stage.agent_role}
                  </span>
                )}
              </div>

              {!isLast && (
                <div className="flex-shrink-0 w-full max-w-[40px] pt-4">
                  <div className={`h-0.5 ${statusStyle.line} transition-colors duration-300`} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 当前阶段提示 */}
      {currentStageIdx >= 0 && currentStageIdx < workflow.stages.length && (
        <div className="mt-5 pt-4 border-t border-surface-300">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-hermes-400 animate-pulse" />
            <span className="text-sm text-surface-700">
              当前阶段：
              <span className="text-hermes-400 font-medium">{workflow.stages[currentStageIdx].name}</span>
            </span>
            {workflow.iteration_count > 0 && (
              <span className="text-xs text-surface-500 ml-2">
                迭代 {workflow.iteration_count}/{workflow.max_iterations}
              </span>
            )}
          </div>
          {workflow.error_message && (
            <div className="mt-2 text-xs text-red-400">
              {workflow.error_message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
