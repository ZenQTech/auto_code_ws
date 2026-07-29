/**
 * # ============================================================
 * PlanViewer 组件 (v6.37.0 Cycle 17 P0-1)
 * # ============================================================
 * 核心作用：展示 Composer Plan Mode 的执行计划
 * 使用场景：ComposerPanel 在 plan 阶段渲染此组件
 * 功能要点：
 *   - 显示计划摘要（影响文件数 / 总修改行数 / 风险等级）
 *   - 步骤列表（按文件分组）
 *   - 每个步骤支持：批准 / 拒绝 / 修改
 *   - 批量操作：全部批准 / 全部拒绝
 *   - 执行按钮（计划批准后）
 * ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 17 P0-1 初次创建
 * ============================================================
 */

import React, { useState } from 'react';
import type {
  Plan,
  PlanStep,
  PlanStepOperation,
  PlanStepRisk,
  PlanStepStatus,
  PlanStage,
} from '../utils/composerEngine.plan';
import { calculateOverallRisk, getApprovedSteps } from '../utils/composerEngine.plan';

export interface PlanViewerProps {
  /** 当前 Plan（null 时显示空状态） */
  plan: Plan | null;
  /** 当前阶段 */
  stage: PlanStage;
  /** 步骤操作回调 */
  onApproveStep: (stepId: string) => void;
  onRejectStep: (stepId: string, reason?: string) => void;
  onModifyStep: (stepId: string, description: string) => void;
  /** 整体操作回调 */
  onApproveAll: () => void;
  onRejectAll: () => void;
  onApprovePlan: () => void;
  onRejectPlan: (reason?: string) => void;
  onExecutePlan: () => void;
  /** 关闭 Plan 模式 */
  onClose: () => void;
}

// ============================================================
// 工具组件
// ====================================

/** 操作类型徽章 */
const OperationBadge: React.FC<{ operation: PlanStepOperation }> = ({ operation }) => {
  const config: Record<PlanStepOperation, { label: string; className: string }> = {
    create: { label: '创建', className: 'bg-green-500/20 text-green-300 border-green-500/30' },
    modify: { label: '修改', className: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
    delete: { label: '删除', className: 'bg-red-500/20 text-red-300 border-red-500/30' },
    rename: { label: '重命名', className: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
  };
  const c = config[operation];
  return (
    <span
      data-testid={`plan-op-${operation}`}
      className={`px-2 py-0.5 text-xs rounded border ${c.className}`}
    >
      {c.label}
    </span>
  );
};

/** 风险等级徽章 */
const RiskBadge: React.FC<{ risk: PlanStepRisk }> = ({ risk }) => {
  const config: Record<PlanStepRisk, { label: string; className: string }> = {
    low: { label: '低风险', className: 'bg-slate-500/20 text-slate-300' },
    medium: { label: '中风险', className: 'bg-yellow-500/20 text-yellow-300' },
    high: { label: '高风险', className: 'bg-red-500/20 text-red-300' },
  };
  const c = config[risk];
  return (
    <span
      data-testid={`plan-risk-${risk}`}
      className={`px-2 py-0.5 text-xs rounded ${c.className}`}
    >
      {c.label}
    </span>
  );
};

/** 步骤状态徽章 */
const StatusBadge: React.FC<{ status: PlanStepStatus }> = ({ status }) => {
  const config: Record<PlanStepStatus, { label: string; className: string }> = {
    pending: { label: '待审', className: 'bg-slate-500/20 text-slate-300' },
    approved: { label: '已批准', className: 'bg-green-500/20 text-green-300' },
    rejected: { label: '已拒绝', className: 'bg-red-500/20 text-red-300' },
    modified: { label: '已修改', className: 'bg-blue-500/20 text-blue-300' },
  };
  const c = config[status];
  return (
    <span
      data-testid={`plan-status-${status}`}
      className={`px-2 py-0.5 text-xs rounded ${c.className}`}
    >
      {c.label}
    </span>
  );
};

/** 单个步骤行 */
const StepRow: React.FC<{
  step: PlanStep;
  onApprove: (id: string) => void;
  onReject: (id: string, reason?: string) => void;
  onModify: (id: string, desc: string) => void;
  disabled: boolean;
}> = ({ step, onApprove, onReject, onModify, disabled }) => {
  const [editing, setEditing] = useState(false);
  const [editedDesc, setEditedDesc] = useState(step.modifiedDescription ?? step.description);

  const handleSave = () => {
    if (editedDesc && editedDesc.trim()) {
      onModify(step.id, editedDesc);
      setEditing(false);
    }
  };

  return (
    <div
      data-testid={`plan-step-${step.id}`}
      data-status={step.status}
      className={[
        'p-3 rounded border',
        step.status === 'rejected' ? 'opacity-50 line-through' : '',
        step.status === 'approved' || step.status === 'modified'
          ? 'border-green-500/30 bg-green-500/5'
          : 'border-surface-700 bg-surface-900/50',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <OperationBadge operation={step.operation} />
            <RiskBadge risk={step.riskLevel} />
            <StatusBadge status={step.status} />
            <span className="text-xs text-slate-400">
              {step.estimatedLines} 行
            </span>
          </div>
          <div className="mt-1 text-sm text-slate-200 font-mono">
            {step.filePath}
          </div>
          {editing ? (
            <div className="mt-2 flex gap-2">
              <input
                data-testid={`plan-step-modify-input-${step.id}`}
                type="text"
                value={editedDesc}
                onChange={(e) => setEditedDesc(e.target.value)}
                className="flex-1 bg-surface-800 border border-surface-600 rounded px-2 py-1 text-sm"
                autoFocus
              />
              <button
                data-testid={`plan-step-modify-save-${step.id}`}
                onClick={handleSave}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded"
              >
                保存
              </button>
              <button
                onClick={() => {
                  setEditedDesc(step.modifiedDescription ?? step.description);
                  setEditing(false);
                }}
                className="px-3 py-1 bg-surface-700 text-slate-200 text-sm rounded"
              >
                取消
              </button>
            </div>
          ) : (
            <div className="mt-1 text-sm text-slate-300">
              {step.modifiedDescription ?? step.description}
            </div>
          )}
          {step.rejectionReason && (
            <div className="mt-1 text-xs text-red-300">
              拒绝原因：{step.rejectionReason}
            </div>
          )}
        </div>
        {!disabled && step.status === 'pending' && !editing && (
          <div className="flex flex-col gap-1">
            <button
              data-testid={`plan-step-approve-${step.id}`}
              onClick={() => onApprove(step.id)}
              className="px-2 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded"
              title="批准"
            >
              ✓
            </button>
            <button
              data-testid={`plan-step-reject-${step.id}`}
              onClick={() => onReject(step.id)}
              className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded"
              title="拒绝"
            >
              ✗
            </button>
            <button
              data-testid={`plan-step-edit-${step.id}`}
              onClick={() => setEditing(true)}
              className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded"
              title="修改"
            >
              ✎
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// 主组件
// ============================================================

/**
 * PlanViewer 组件
 */
export const PlanViewer: React.FC<PlanViewerProps> = ({
  plan,
  stage,
  onApproveStep,
  onRejectStep,
  onModifyStep,
  onApproveAll,
  onRejectAll,
  onRejectPlan,
  onExecutePlan,
  onClose,
}) => {
  // 加载状态（优先于空状态）
  if (stage === 'analyzing') {
    return (
      <div
        data-testid="plan-viewer-analyzing"
        className="p-6 text-center text-slate-400"
      >
        <div className="animate-pulse text-2xl mb-2">⚙️</div>
        <div>分析中...</div>
        <div className="text-sm mt-1">正在分析项目并生成执行计划</div>
      </div>
    );
  }

  // 执行状态（优先于空状态）
  if (stage === 'executing') {
    return (
      <div
        data-testid="plan-viewer-executing"
        className="p-6 text-center text-slate-400"
      >
        <div className="animate-pulse text-2xl mb-2">🚀</div>
        <div>执行中...</div>
        <div className="text-sm mt-1">正在按计划生成 Edits</div>
      </div>
    );
  }

  // 空状态
  if (!plan) {
    return (
      <div
        data-testid="plan-viewer-empty"
        className="p-6 text-center text-slate-400"
      >
        <div className="text-4xl mb-2">📋</div>
        <div>暂无计划</div>
        <div className="text-sm mt-1">输入 prompt 后将自动生成计划</div>
      </div>
    );
  }

  // 完成状态
  if (stage === 'completed') {
    return (
      <div
        data-testid="plan-viewer-completed"
        className="p-6 text-center"
      >
        <div className="text-4xl mb-2">✅</div>
        <div className="text-green-300 font-semibold">计划已执行</div>
        <div className="text-sm mt-1 text-slate-400">
          {getApprovedSteps(plan).length} 个步骤已生成 Edit 草稿
        </div>
        <button
          data-testid="plan-close-button"
          onClick={onClose}
          className="mt-4 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-slate-200 rounded"
        >
          关闭
        </button>
      </div>
    );
  }

  // 拒绝状态
  if (stage === 'rejected') {
    return (
      <div
        data-testid="plan-viewer-rejected"
        className="p-6 text-center"
      >
        <div className="text-4xl mb-2">❌</div>
        <div className="text-red-300 font-semibold">计划已拒绝</div>
        <div className="text-sm mt-1 text-slate-400">所有 pending 步骤已标记为拒绝</div>
        <button
          data-testid="plan-close-button"
          onClick={onClose}
          className="mt-4 px-4 py-2 bg-surface-700 hover:bg-surface-600 text-slate-200 rounded"
        >
          关闭
        </button>
      </div>
    );
  }

  // 计划展示
  const overallRisk = calculateOverallRisk(plan);
  const approvedSteps = getApprovedSteps(plan);
  // 由于前面多处 if stage === 'xxx' 提前 return，TS 已将 stage 类型收窄，
  // 这里显式标注为完整 PlanStage 以允许后续比较
  const currentStage: PlanStage = stage;
  const canExecute = currentStage === 'planned' && approvedSteps.length > 0;

  return (
    <div
      data-testid="plan-viewer"
      data-stage={stage}
      className="flex flex-col h-full"
    >
      {/* 头部：摘要 */}
      <div className="p-4 border-b border-surface-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-200">执行计划</h3>
          <button
            data-testid="plan-reject-all-button"
            onClick={() => onRejectPlan('整体拒绝')}
            className="text-xs text-red-400 hover:text-red-300"
          >
            全部拒绝
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="bg-surface-800 rounded p-2">
            <div className="text-slate-400">文件数</div>
            <div className="text-lg font-semibold text-slate-100" data-testid="plan-file-count">
              {plan.steps.length}
            </div>
          </div>
          <div className="bg-surface-800 rounded p-2">
            <div className="text-slate-400">总行数</div>
            <div className="text-lg font-semibold text-slate-100" data-testid="plan-total-lines">
              {plan.totalLines}
            </div>
          </div>
          <div className="bg-surface-800 rounded p-2">
            <div className="text-slate-400">风险</div>
            <div className="text-lg font-semibold text-slate-100">
              <RiskBadge risk={overallRisk} />
            </div>
          </div>
        </div>
        <div className="mt-2 text-sm text-slate-300" data-testid="plan-summary">
          {plan.summary}
        </div>
      </div>

      {/* 步骤列表 */}
      <div
        data-testid="plan-step-list"
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {plan.steps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            onApprove={onApproveStep}
            onReject={onRejectStep}
            onModify={onModifyStep}
            disabled={currentStage === 'approved' || currentStage === 'executing' || currentStage === 'completed'}
          />
        ))}
      </div>

      {/* 底部：批量操作 */}
      <div className="p-4 border-t border-surface-700 space-y-2">
        <div className="flex gap-2">
          <button
            data-testid="plan-approve-all-button"
            onClick={onApproveAll}
            disabled={currentStage === 'approved'}
            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-surface-700 disabled:text-slate-500 text-white text-sm rounded"
          >
            全部批准
          </button>
          <button
            data-testid="plan-reject-all-button-bottom"
            onClick={onRejectAll}
            disabled={currentStage === 'rejected'}
            className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-500 disabled:bg-surface-700 disabled:text-slate-500 text-white text-sm rounded"
          >
            全部拒绝
          </button>
        </div>
        <button
          data-testid="plan-execute-button"
          onClick={onExecutePlan}
          disabled={!canExecute}
          className="w-full px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-surface-700 disabled:text-slate-500 text-white text-sm rounded font-semibold"
        >
          {canExecute
            ? `执行计划（${approvedSteps.length} 个步骤）`
            : approvedSteps.length === 0
            ? '请至少批准一个步骤'
            : '已批准'}
        </button>
      </div>
    </div>
  );
};

export default PlanViewer;
