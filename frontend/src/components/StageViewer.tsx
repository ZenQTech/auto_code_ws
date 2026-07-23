/**
 * # ============================================================
 * # StageViewer 阶段详情查看器组件
 * # ============================================================
 * # 核心作用：展示单个工作流阶段的详细信息
 * #           包括输入/输出文档、智能体对话记录、操作按钮
 * # 输入参数：
 * #   - stage: StageDetail | null，阶段详情
 * #   - loading?: boolean，加载状态
 * #   - onRetry?: () => void，重试回调
 * #   - onSkip?: () => void，跳过回调
 * #   - onClose?: () => void，关闭回调
 * # 修改记录：
 * #   - 2026-06-25 | v1.0.0 | 初始创建
 * # ============================================================
 */

import type { StageDetail } from '../types';

interface Props {
  stage: StageDetail | null;
  loading?: boolean;
  onRetry?: () => void;
  onSkip?: () => void;
  onClose?: () => void;
}

export default function StageViewer({ stage, loading, onRetry, onSkip, onClose }: Props) {
  if (loading) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="skeleton h-6 w-32 rounded mb-4" />
        <div className="skeleton h-4 w-full rounded mb-2" />
        <div className="skeleton h-4 w-3/4 rounded mb-2" />
        <div className="skeleton h-32 w-full rounded mb-4" />
        <div className="skeleton h-4 w-1/2 rounded" />
      </div>
    );
  }

  if (!stage) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">📋</span>
          <span>选择阶段查看详情</span>
        </div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    pending: 'text-surface-500',
    in_progress: 'text-hermes-400',
    completed: 'text-emerald-400',
    failed: 'text-red-400',
  };

  const statusLabels: Record<string, string> = {
    pending: '等待中',
    in_progress: '进行中',
    completed: '已完成',
    failed: '失败',
  };

  return (
    <div className="glass rounded-xl p-5 animate-fade-in">
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-surface-950">{stage.stage_name}</h3>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            stage.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
            stage.status === 'in_progress' ? 'bg-hermes-500/20 text-hermes-400' :
            stage.status === 'failed' ? 'bg-red-500/20 text-red-400' :
            'bg-surface-200 text-surface-500'
          }`}>
            {statusLabels[stage.status] || stage.status}
          </span>
          {stage.agent_role && (
            <span className="text-xs text-surface-500">| {stage.agent_role}</span>
          )}
        </div>
        {onClose && (
          <button onClick={onClose} className="text-surface-500 hover:text-surface-300 text-lg">✕</button>
        )}
      </div>

      {/* 时间信息 */}
      {(stage.started_at || stage.completed_at) && (
        <div className="flex items-center gap-4 mb-4 text-xs text-surface-500">
          {stage.started_at && (
            <span>开始: {new Date(stage.started_at).toLocaleString('zh-CN')}</span>
          )}
          {stage.completed_at && (
            <span>完成: {new Date(stage.completed_at).toLocaleString('zh-CN')}</span>
          )}
        </div>
      )}

      {/* 输出文档 */}
      {stage.output_doc && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-surface-700 mb-2">输出文档</h4>
          <div className="bg-surface-100 rounded-lg p-3 max-h-64 overflow-y-auto">
            <pre className="text-xs text-surface-700 whitespace-pre-wrap font-mono">
              {stage.output_doc}
            </pre>
          </div>
        </div>
      )}

      {/* 对话摘要 */}
      {stage.conversation_summary && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-surface-700 mb-2">智能体对话摘要</h4>
          <div className="bg-surface-100 rounded-lg p-3 max-h-48 overflow-y-auto">
            <pre className="text-xs text-surface-700 whitespace-pre-wrap">
              {stage.conversation_summary}
            </pre>
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-3 border-t border-surface-300">
        {onRetry && (
          <button
            onClick={onRetry}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-hermes-500/20 text-hermes-400 hover:bg-hermes-500/30 transition-colors"
          >
            重试
          </button>
        )}
        {onSkip && stage.status !== 'completed' && (
          <button
            onClick={onSkip}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-200 text-surface-600 hover:bg-surface-300 transition-colors"
          >
            跳过
          </button>
        )}
      </div>
    </div>
  );
}
