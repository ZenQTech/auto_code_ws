/**
 * # ============================================================
 * # PlanEditorModal - Plan 编辑模态弹窗（P0-3 Plan Mode 深化）
 * # ============================================================
 * # 核心作用：在 PlanMode 中展示 PlanEditor，提供完整的
 * #           Plan → Execute → Rollback 链路 UI
 * # 运行流程：
 * #   1. 接收 plan 文档（PlanDocument）
 * #   2. 渲染 PlanEditor + 操作栏（保存修改 / 确认执行 / 重新生成 / 回滚）
 * #   3. 保存修改 → 调用 modifyPlanApi → 持久化
 * #   4. 确认执行 → 调用 confirmPlanApi → 进入 execute
 * #   5. 重新生成 → 调用 rejectPlanApi + 重新 generate
 * #   6. 回滚 → 恢复上一个 git snapshot（标记 plan-pending）
 * # 输入参数：见 PlanEditorModalProps
 * # 输出结果：模态弹窗 DOM
 * # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | P0-3 Plan Mode 深化 - Plan→Execute→Rollback 完整 UI
 * # ============================================================
 */

import React, { useState, useEffect, useCallback } from 'react';
import PlanEditor from './PlanEditor';
import type { PlanDocument } from '../hooks/useWorkflowApi';
import {
  generatePlan,
  getPlan,
  confirmPlanApi,
  modifyPlanApi,
  rejectPlanApi,
} from '../hooks/useWorkflowApi';

export interface PlanEditorModalProps {
  /** 工作流 ID */
  workflowId: string;
  /** 初始 Plan（可选，未传则从后端拉取） */
  initialPlan?: PlanDocument | null;
  /** 是否显示 */
  visible: boolean;
  /** 确认执行回调（确认 Plan 后触发） */
  onConfirm: (plan: PlanDocument) => void | Promise<void>;
  /** 关闭模态回调 */
  onClose: () => void;
  /** 修改后回调（用于在父组件同步 plan 状态） */
  onPlanChange?: (plan: PlanDocument) => void;
}

/** 当前操作阶段 */
type ActionStage = 'view' | 'edit' | 'confirming' | 'regenerating' | 'rolling-back' | 'idle';

const STATUS_BADGES: Record<string, { label: string; color: string }> = {
  pending: { label: '待确认', color: 'bg-amber-500/20 text-amber-400 border-amber-500/40' },
  confirmed: { label: '已确认', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' },
  modified: { label: '已修改', color: 'bg-blue-500/20 text-blue-400 border-blue-500/40' },
  rejected: { label: '已拒绝', color: 'bg-red-500/20 text-red-400 border-red-500/40' },
};

/**
 * PlanEditorModal - 计划编辑器模态弹窗
 */
export const PlanEditorModal: React.FC<PlanEditorModalProps> = ({
  workflowId,
  initialPlan = null,
  visible,
  onConfirm,
  onClose,
  onPlanChange,
}) => {
  // 当前 Plan 状态
  const [plan, setPlan] = useState<PlanDocument | null>(initialPlan);
  // 用户编辑后的 Plan（待保存）
  const [editedPlan, setEditedPlan] = useState<PlanDocument | null>(null);
  // 操作阶段
  const [stage, setStage] = useState<ActionStage>('idle');
  // 错误信息
  const [error, setError] = useState<string | null>(null);
  // 是否处于编辑模式
  const [editMode, setEditMode] = useState(false);
  // 修改说明
  const [modificationNote, setModificationNote] = useState('');
  // 拒绝原因
  const [rejectReason, setRejectReason] = useState('');
  // 显示拒绝输入
  const [showRejectInput, setShowRejectInput] = useState(false);
  // 操作历史（用于回滚）
  const [planHistory, setPlanHistory] = useState<PlanDocument[]>([]);
  // 操作消息
  const [actionMessage, setActionMessage] = useState<string>('');
  // 确认执行按钮防重入
  const [isConfirming, setIsConfirming] = useState(false);
  // 关闭动画
  const [isClosing, setIsClosing] = useState(false);

  // 加载初始 plan
  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (initialPlan) {
      setPlan(initialPlan);
      setEditedPlan(initialPlan);
      return;
    }
    // 拉取已有 plan
    setStage('idle');
    (async () => {
      try {
        const resp = await getPlan(workflowId);
        if (resp.plan) {
          setPlan(resp.plan);
          setEditedPlan(resp.plan);
        }
      } catch (e) {
        setError(`加载 Plan 失败: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();
  }, [visible, workflowId, initialPlan]);

  // 同步 plan 变化到父组件
  useEffect(() => {
    if (editedPlan && onPlanChange) {
      onPlanChange(editedPlan);
    }
  }, [editedPlan, onPlanChange]);

  // 关闭处理（带动画）
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 200);
  }, [onClose]);

  // ESC 关闭
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isConfirming && stage === 'idle') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, isConfirming, stage, handleClose]);

  // 生成新 Plan
  const handleGenerate = useCallback(async () => {
    setStage('regenerating');
    setError(null);
    setActionMessage('正在生成 Plan...');
    try {
      // 保存当前 plan 到历史（用于回滚）
      if (plan) {
        setPlanHistory((h) => [...h, plan]);
      }
      const resp = await generatePlan({ workflowId, objective: '' });
      if (resp.success && resp.plan) {
        setPlan(resp.plan);
        setEditedPlan(resp.plan);
        setActionMessage(`✓ Plan 已生成: ${resp.message}`);
        setEditMode(true);
      } else {
        setError(resp.message || 'Plan 生成失败');
      }
    } catch (e) {
      setError(`生成失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStage('idle');
    }
  }, [workflowId, plan]);

  // 保存修改
  const handleSaveEdit = useCallback(async () => {
    if (!editedPlan) return;
    setStage('edit');
    setError(null);
    setActionMessage('正在保存修改...');
    try {
      if (plan) {
        setPlanHistory((h) => [...h, plan]);
      }
      const resp = await modifyPlanApi(
        workflowId,
        editedPlan,
        modificationNote || '用户手动编辑'
      );
      if (resp.success && resp.plan) {
        setPlan(resp.plan);
        setEditedPlan(resp.plan);
        setActionMessage(`✓ ${resp.message}`);
        setEditMode(false);
        setModificationNote('');
      } else {
        setError(resp.message || '保存失败');
      }
    } catch (e) {
      setError(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStage('idle');
    }
  }, [editedPlan, plan, workflowId, modificationNote]);

  // 确认执行
  const handleConfirm = useCallback(async () => {
    if (!editedPlan) return;
    if (isConfirming) return;
    setIsConfirming(true);
    setStage('confirming');
    setError(null);
    setActionMessage('正在确认 Plan 并进入执行阶段...');
    try {
      // 先保存当前编辑
      if (editMode && editedPlan && plan) {
        if (JSON.stringify(editedPlan) !== JSON.stringify(plan)) {
          await modifyPlanApi(workflowId, editedPlan, '确认前自动保存');
        }
      }
      const resp = await confirmPlanApi(
        workflowId,
        editedPlan.plan_id,
        modificationNote
      );
      if (resp.success && resp.plan) {
        setPlan(resp.plan);
        setEditedPlan(resp.plan);
        setActionMessage(`✓ ${resp.message}`);
        // 触发父组件回调
        await onConfirm(resp.plan);
        handleClose();
      } else {
        setError(resp.message || '确认失败');
      }
    } catch (e) {
      setError(`确认失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsConfirming(false);
      setStage('idle');
    }
  }, [editedPlan, plan, workflowId, editMode, modificationNote, isConfirming, onConfirm, handleClose]);

  // 拒绝并重新生成
  const handleReject = useCallback(async () => {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    setStage('regenerating');
    setError(null);
    setActionMessage('正在拒绝并重新生成...');
    try {
      if (plan) {
        setPlanHistory((h) => [...h, plan]);
      }
      const reason = rejectReason.trim() || '用户拒绝当前 Plan';
      await rejectPlanApi(workflowId, reason);
      // 触发重新生成
      const resp = await generatePlan({ workflowId, objective: '' });
      if (resp.success && resp.plan) {
        setPlan(resp.plan);
        setEditedPlan(resp.plan);
        setActionMessage(`✓ Plan 已重新生成（${resp.message}）`);
        setEditMode(true);
        setShowRejectInput(false);
        setRejectReason('');
      } else {
        setError(resp.message || '重新生成失败');
      }
    } catch (e) {
      setError(`拒绝/重新生成失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStage('idle');
    }
  }, [showRejectInput, rejectReason, plan, workflowId]);

  // 回滚到上一个 plan
  const handleRollback = useCallback(async () => {
    if (planHistory.length === 0) {
      setError('没有可回滚的历史版本');
      return;
    }
    setStage('rolling-back');
    setError(null);
    setActionMessage('正在回滚到上一个 Plan 版本...');
    try {
      const previousPlan = planHistory[planHistory.length - 1];
      const resp = await modifyPlanApi(
        workflowId,
        previousPlan,
        '回滚到历史版本'
      );
      if (resp.success && resp.plan) {
        setPlan(resp.plan);
        setEditedPlan(resp.plan);
        setPlanHistory((h) => h.slice(0, -1));
        setActionMessage(`✓ 已回滚到 ${previousPlan.generated_at}`);
        setEditMode(false);
      } else {
        setError(resp.message || '回滚失败');
      }
    } catch (e) {
      setError(`回滚失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setStage('idle');
    }
  }, [planHistory, workflowId]);

  // 不可见且不在关闭动画中时不渲染
  if (!visible && !isClosing) return null;

  const statusBadge = plan ? STATUS_BADGES[plan.status] || STATUS_BADGES.pending : null;
  const isProcessing = ['regenerating', 'edit', 'confirming', 'rolling-back'].includes(stage);
  const hasUnsavedChanges = editMode && editedPlan && plan && JSON.stringify(editedPlan) !== JSON.stringify(plan);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={`bg-[#1a1a2e] border border-purple-500/30 rounded-2xl shadow-2xl w-full max-w-5xl mx-4 max-h-[92vh] flex flex-col ${
          isClosing ? 'animate-modal-out' : 'animate-modal-in'
        }`}
      >
        {/* ============================================================ */}
        {/* 标题栏 */}
        {/* ============================================================ */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-purple-300">
                Plan 模式 · 计划编辑器
              </h2>
              <p className="text-xs text-surface-500 mt-0.5">
                Plan → Execute → Rollback · 工作流{' '}
                <code className="text-purple-300">{workflowId.slice(0, 8)}...</code>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusBadge && (
              <span
                className={`px-2 py-0.5 text-[10px] rounded-full border ${statusBadge.color}`}
              >
                {statusBadge.label}
              </span>
            )}
            {planHistory.length > 0 && (
              <span className="px-2 py-0.5 text-[10px] rounded-full bg-surface-200/50 text-surface-600 border border-surface-300/40">
                历史 {planHistory.length}
              </span>
            )}
            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="icon-btn disabled:opacity-30"
              aria-label="关闭"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* ============================================================ */}
        {/* 操作消息条 */}
        {/* ============================================================ */}
        {(actionMessage || error) && (
          <div
            className={`px-6 py-2 text-xs flex items-center gap-2 flex-shrink-0 ${
              error
                ? 'bg-red-500/10 text-red-400 border-b border-red-500/20'
                : 'bg-purple-500/10 text-purple-300 border-b border-purple-500/20'
            }`}
          >
            {error ? (
              <>
                <span>❌</span>
                <span>{error}</span>
              </>
            ) : (
              <>
                {stage === 'regenerating' || stage === 'edit' || stage === 'rolling-back' ? (
                  <svg
                    className="animate-spin w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                ) : (
                  <span>ℹ️</span>
                )}
                <span>{actionMessage}</span>
              </>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* 内容区 */}
        {/* ============================================================ */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {!plan ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">📋</div>
              <p className="text-surface-500 text-sm">该工作流尚未生成 Plan</p>
              <button
                onClick={handleGenerate}
                disabled={isProcessing}
                className="mt-4 px-4 py-2 bg-gradient-to-br from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 disabled:from-surface-300 disabled:to-surface-300 text-white rounded-lg text-sm font-medium transition-all"
              >
                生成 Plan
              </button>
            </div>
          ) : (
            <>
              {/* 修改说明输入 */}
              {editMode && (
                <div className="mb-3 p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg">
                  <label className="text-[10px] text-blue-400 font-medium block mb-1">
                    修改说明（可选，会附加到 Plan.user_modifications）
                  </label>
                  <input
                    type="text"
                    value={modificationNote}
                    onChange={(e) => setModificationNote(e.target.value)}
                    placeholder="例如：增加数据库索引、拆分阶段..."
                    className="w-full px-2 py-1 text-xs bg-surface-200/50 border border-surface-300/50 rounded text-surface-900 outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {/* 拒绝原因输入 */}
              {showRejectInput && (
                <div className="mb-3 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
                  <label className="text-[10px] text-red-400 font-medium block mb-1">
                    拒绝原因（将触发 Plan 重新生成）
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="例如：缺少错误处理阶段"
                      className="flex-1 px-2 py-1 text-xs bg-surface-200/50 border border-surface-300/50 rounded text-surface-900 outline-none focus:border-red-500"
                    />
                    <button
                      onClick={() => {
                        setShowRejectInput(false);
                        setRejectReason('');
                      }}
                      className="px-2 py-1 text-xs text-surface-600 hover:text-surface-900 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleReject}
                      disabled={isProcessing}
                      className="px-2 py-1 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 rounded transition-colors"
                    >
                      确认拒绝
                    </button>
                  </div>
                </div>
              )}

              {/* PlanEditor */}
              <PlanEditor
                plan={editedPlan || plan}
                onChange={setEditedPlan}
                readOnly={!editMode}
                highlightRiskLevel="all"
              />
            </>
          )}
        </div>

        {/* ============================================================ */}
        {/* 底部操作栏 */}
        {/* ============================================================ */}
        {plan && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-purple-500/20 flex-shrink-0 bg-surface-100/30">
            {/* 左侧：编辑/历史操作 */}
            <div className="flex items-center gap-2">
              {!editMode ? (
                <button
                  onClick={() => setEditMode(true)}
                  disabled={isProcessing}
                  className="px-3 py-1.5 text-xs text-purple-300 hover:text-purple-200 border border-purple-500/30 hover:border-purple-500/60 rounded transition-colors disabled:opacity-30"
                >
                  ✏️ 编辑
                </button>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setEditedPlan(plan);
                      setEditMode(false);
                      setModificationNote('');
                    }}
                    disabled={isProcessing}
                    className="px-3 py-1.5 text-xs text-surface-600 hover:text-surface-900 border border-surface-300/50 rounded transition-colors disabled:opacity-30"
                  >
                    取消编辑
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    disabled={isProcessing || !hasUnsavedChanges}
                    className="px-3 py-1.5 text-xs bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/40 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    💾 保存修改
                  </button>
                </>
              )}
              <button
                onClick={handleRollback}
                disabled={isProcessing || planHistory.length === 0}
                className="px-3 py-1.5 text-xs text-amber-400 hover:text-amber-300 border border-amber-500/30 hover:border-amber-500/60 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title={planHistory.length === 0 ? '没有可回滚的历史' : `回滚到上一个版本（共 ${planHistory.length} 个历史）`}
              >
                ↩️ 回滚 {planHistory.length > 0 && `(${planHistory.length})`}
              </button>
            </div>

            {/* 右侧：主要操作 */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleReject}
                disabled={isProcessing || showRejectInput}
                className="px-3 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/60 rounded transition-colors disabled:opacity-30"
              >
                {showRejectInput ? '请在上方输入原因' : '❌ 拒绝'}
              </button>
              <button
                onClick={handleGenerate}
                disabled={isProcessing}
                className="px-3 py-1.5 text-xs text-surface-600 hover:text-surface-900 border border-surface-300/50 rounded transition-colors disabled:opacity-30"
              >
                🔄 重新生成
              </button>
              <button
                onClick={handleConfirm}
                disabled={isProcessing || isConfirming || !plan}
                className="px-4 py-1.5 text-xs bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 disabled:from-surface-300 disabled:to-surface-300 text-white font-medium rounded transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
              >
                {isConfirming ? (
                  <>
                    <svg
                      className="animate-spin w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    确认中...
                  </>
                ) : (
                  <>✓ 确认执行</>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PlanEditorModal;
