/**
 * # ============================================================
 * # 架构设计与批判迭代模态弹窗 - ArchitectureDesignModal
 * # ============================================================
 * # 核心作用：在需求澄清完成后，以模态弹窗形式展示架构设计
 * #           批判迭代阶段的完整结果，包括 V2.0 需求文档预览、
 * #           批判分析缺陷清单、确认 / 返回修改按钮
 * # 运行流程：
 * #   1. 接收后端返回的 V2.0 需求文档和批判分析结果
 * #   2. 渲染"架构设计与批判迭代阶段"标题
 * #   3. 展示需求文档 V2.0 预览区域（可滚动）
 * #   4. 展示批判分析摘要（综合评分、缺陷统计）
 * #   5. 提供"确认"和"返回修改"两个操作按钮
 * #   6. 确认后触发 onConfirm 回调，驳回后触发 onReject 回调
 * # 输入参数：
 * #   - requirementV2: 迭代优化后的需求文档 V2.0（Markdown）
 * #   - critiqueResult: 批判分析结果（含评分、缺陷清单）
 * #   - isLoading: 是否正在加载中
 * #   - iterationCount: 当前迭代次数
 * #   - maxIterations: 最大迭代次数
 * #   - onConfirm: 确认通过回调
 * #   - onReject: 返回修改回调（需传入驳回原因）
 * # 输出结果：模态弹窗 DOM
 * # 修改记录：
#*   - 2026-07-01 | v1.0.0 | 初始版本，创建架构设计批判迭代模态弹窗
 *   - 2026-07-01 | v1.1.0 | 文档预览区从纯文本改为 Markdown 渲染（renderMarkdown）
 *   - 2026-07-24 | v1.2.0 | 修复 Hooks 调用顺序错误导致的 "Rendered more hooks than during
 *     the previous render"：删除 isLoading 早返回中的 Hook 调用不一致点（useMemo 在早返回之后），
 *     将 useMemo 上移到所有 useState 之后，确保每次渲染 Hooks 数量和顺序一致
 *   - 2026-07-24 | v1.3.0 | 修复"确认通过按钮无法选择"问题：
 *     ① 新增 isConfirming 本地状态实现按钮防重入 + 加载文字反馈（"确认中..."）；
 *     ② 提升按钮视觉对比度（bg-purple-500/40 + text-white + shadow + ✓ 图标），原透明度
 *        20% 在深色背景下几乎不可见；
 *     ③ 加 disabled + cursor-pointer/cursor-wait 让按钮交互状态可感知；
 *     ④ handleConfirm 改为 async + try/catch/finally 防止 onConfirm 抛错时按钮永远卡住
 * ============================================================
 */

import { useState, useMemo } from 'react';
import { renderMarkdown } from '../utils/markdown';

/** 缺陷项类型 */
export interface DefectItem {
  defect_id: string;
  severity: 'critical' | 'major' | 'minor';
  dimension: string;
  location: string;
  description: string;
  impact_scope: string;
  repair_plan: string;
}

/** 批判分析结果类型 */
export interface CritiqueResultData {
  passed: boolean;
  overall_score: number;
  summary: string;
  dimension_scores: Record<string, number>;
  defect_list: DefectItem[];
}

/** 架构设计模态弹窗 Props */
interface ArchitectureDesignModalProps {
  /** V2.0 需求文档（Markdown 格式） */
  requirementV2: string;
  /** 批判分析结果 */
  critiqueResult: CritiqueResultData | null;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 当前迭代次数 */
  iterationCount: number;
  /** 最大迭代次数 */
  maxIterations: number;
  /** 确认通过回调 */
  onConfirm: () => void;
  /** 返回修改回调，传入驳回原因 */
  onReject: (reason: string) => void;
}

/**
 * 严重程度标签颜色映射
 */
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/40',
  major: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  minor: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: '致命',
  major: '严重',
  minor: '一般',
};

/**
 * 架构设计与批判迭代模态弹窗组件
 *
 * 调用方：由 App.tsx 在架构设计阶段触发渲染
 * 被调用：内部直接渲染，无子组件
 *
 * 标题固定为"架构设计与批判迭代阶段"
 * 遮罩层不响应点击关闭事件
 */
export default function ArchitectureDesignModal(props: ArchitectureDesignModalProps) {
  // v1.2.0 修复（Bug：Hooks 调用顺序不一致导致 "Rendered more hooks than during the
  //   previous render"）：所有 useState 必须在 useMemo 之前声明，避免在 isLoading=true 时
  //   早返回导致 useMemo 缺失，造成两次渲染 Hooks 数量不一致。
  // v1.3.0 增强：新增 isConfirming 状态支持按钮防重入 + 加载指示
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [activeTab, setActiveTab] = useState<'preview' | 'defects'>('preview');
  const [isConfirming, setIsConfirming] = useState(false);

  const {
    requirementV2,
    critiqueResult,
    isLoading,
    iterationCount,
    maxIterations,
    onConfirm,
    onReject,
  } = props;

  // 统计缺陷分布
  const criticalCount = critiqueResult?.defect_list.filter(
    (d) => d.severity === 'critical'
  ).length ?? 0;
  const majorCount = critiqueResult?.defect_list.filter(
    (d) => d.severity === 'major'
  ).length ?? 0;
  const minorCount = critiqueResult?.defect_list.filter(
    (d) => d.severity === 'minor'
  ).length ?? 0;

  /**
   * 使用 useMemo 缓存 Markdown 渲染结果
   * renderMarkdown 内部已做 HTML 转义（XSS 防护），可安全使用 dangerouslySetInnerHTML
   * v1.2.0 修复：移到所有 useState 之后，确保 Hooks 顺序一致
   */
  const renderedRequirementV2 = useMemo(
    () => renderMarkdown(requirementV2 || ''),
    [requirementV2]
  );

  /** 处理驳回 */
  const handleReject = () => {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    if (!rejectReason.trim()) {
      return;
    }
    onReject(rejectReason.trim());
    setRejectReason('');
    setShowRejectInput(false);
  };

  /** 处理确认 - v1.3.0 增强：增加加载状态 + 错误捕获 */
  const handleConfirm = async () => {
    if (isConfirming) return; // v1.3.0 防重入
    setIsConfirming(true);
    try {
      await onConfirm();
    } catch (e) {
      console.error('ArchitectureDesignModal handleConfirm 异常:', e);
    } finally {
      setIsConfirming(false);
    }
  };

  /** 渲染加载状态：v1.2.0 修复：必须放在所有 Hooks 之后 */
  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-[#1a1a2e] border border-purple-500/30 rounded-2xl shadow-2xl max-w-2xl w-full mx-4 p-8 text-center">
          <div className="animate-spin w-12 h-12 border-4 border-purple-500/30 border-t-purple-400 rounded-full mx-auto mb-4" />
          <p className="text-purple-300 text-lg">正在执行架构批判分析...</p>
          <p className="text-gray-500 text-sm mt-2">
            批判反思智能体 + 质量保障智能体正在协作分析架构方案
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={[
          'bg-[#1a1a2e] border border-purple-500/30 rounded-2xl shadow-2xl',
          'max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col',
          'animate-in fade-in zoom-in-95 duration-300',
        ].join(' ')}
      >
        {/* ============================================================ */}
        {/* 标题栏 */}
        {/* ============================================================ */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20">
          <div>
            <h2 className="text-xl font-bold text-purple-300">
              架构设计与批判迭代阶段
            </h2>
            <p className="text-gray-500 text-xs mt-0.5">
              迭代 {iterationCount}/{maxIterations}
              {critiqueResult && (
                <span className="ml-3">
                  综合评分：
                  <span
                    className={
                      critiqueResult.overall_score >= 80
                        ? 'text-green-400'
                        : critiqueResult.overall_score >= 60
                          ? 'text-amber-400'
                          : 'text-red-400'
                    }
                  >
                    {critiqueResult.overall_score}/100
                  </span>
                </span>
              )}
            </p>
          </div>
          {/* 缺陷统计 */}
          {critiqueResult && (
            <div className="flex gap-3 text-xs">
              {criticalCount > 0 && (
                <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded-full border border-red-500/30">
                  致命 {criticalCount}
                </span>
              )}
              {majorCount > 0 && (
                <span className="px-2 py-1 bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
                  严重 {majorCount}
                </span>
              )}
              {minorCount > 0 && (
                <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded-full border border-blue-500/30">
                  一般 {minorCount}
                </span>
              )}
              {criticalCount === 0 && majorCount === 0 && minorCount === 0 && (
                <span className="px-2 py-1 bg-green-500/20 text-green-400 rounded-full border border-green-500/30">
                  无缺陷
                </span>
              )}
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* 选项卡切换 */}
        {/* ============================================================ */}
        <div className="flex border-b border-purple-500/20 px-6">
          <button
            onClick={() => setActiveTab('preview')}
            className={[
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-[1px]',
              activeTab === 'preview'
                ? 'border-purple-400 text-purple-300'
                : 'border-transparent text-gray-500 hover:text-gray-400',
            ].join(' ')}
          >
            需求文档 V2.0 预览
          </button>
          <button
            onClick={() => setActiveTab('defects')}
            className={[
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-[1px]',
              activeTab === 'defects'
                ? 'border-purple-400 text-purple-300'
                : 'border-transparent text-gray-500 hover:text-gray-400',
            ].join(' ')}
          >
            缺陷清单 ({critiqueResult?.defect_list.length ?? 0})
          </button>
        </div>

        {/* ============================================================ */}
        {/* 内容区域 */}
        {/* ============================================================ */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {activeTab === 'preview' ? (
            /* 需求文档 V2.0 预览 - Markdown 渲染 */
            requirementV2 ? (
              <div
                className="text-sm text-gray-300 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderedRequirementV2 }}
              />
            ) : (
              <p className="text-gray-500 text-center py-8">（暂无需求文档内容）</p>
            )
          ) : (
            /* 缺陷清单 */
            <div className="space-y-3">
              {critiqueResult?.summary && (
                <div className="bg-purple-500/5 border border-purple-500/20 rounded-lg p-4 mb-4">
                  <p className="text-purple-300 text-sm font-medium mb-1">
                    总体评估
                  </p>
                  <p className="text-gray-400 text-sm">{critiqueResult.summary}</p>
                </div>
              )}

              {critiqueResult?.dimension_scores &&
                Object.keys(critiqueResult.dimension_scores).length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mb-4">
                    {Object.entries(critiqueResult.dimension_scores).map(
                      ([dim, score]) => (
                        <div
                          key={dim}
                          className="bg-[#0f0f1a] rounded-lg p-3 border border-purple-500/10"
                        >
                          <span className="text-gray-400 text-xs">{dim}</span>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                              <div
                                className={[
                                  'h-full rounded-full transition-all',
                                  score >= 80
                                    ? 'bg-green-500'
                                    : score >= 60
                                      ? 'bg-amber-500'
                                      : 'bg-red-500',
                                ].join(' ')}
                                style={{ width: `${score}%` }}
                              />
                            </div>
                            <span className="text-gray-300 text-xs font-mono">
                              {score}
                            </span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}

              {critiqueResult?.defect_list.map((defect) => (
                <div
                  key={defect.defect_id}
                  className="bg-[#0f0f1a] border border-purple-500/10 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          'px-2 py-0.5 text-xs rounded-full border',
                          SEVERITY_COLORS[defect.severity] ??
                            'bg-gray-500/20 text-gray-400 border-gray-500/40',
                        ].join(' ')}
                      >
                        {SEVERITY_LABELS[defect.severity] ?? defect.severity}
                      </span>
                      <span className="text-purple-400 text-xs font-mono">
                        {defect.defect_id}
                      </span>
                      <span className="text-gray-500 text-xs">
                        [{defect.dimension}]
                      </span>
                    </div>
                    <span className="text-gray-600 text-xs">
                      {defect.location}
                    </span>
                  </div>
                  <p className="text-gray-300 text-sm mb-2">
                    {defect.description}
                  </p>
                  <div className="text-gray-500 text-xs space-y-1">
                    <p>
                      <span className="text-gray-600">影响范围：</span>
                      {defect.impact_scope}
                    </p>
                    {defect.repair_plan && (
                      <p>
                        <span className="text-green-600">修复方案：</span>
                        {defect.repair_plan}
                      </p>
                    )}
                  </div>
                </div>
              ))}

              {(!critiqueResult ||
                critiqueResult.defect_list.length === 0) && (
                <div className="text-center py-8 text-gray-500">
                  暂无缺陷记录
                </div>
              )}
            </div>
          )}
        </div>

        {/* ============================================================ */}
        {/* 操作说明 */}
        {/* ============================================================ */}
        <div className="px-6 py-3 border-t border-purple-500/10 bg-purple-500/5">
          <p className="text-gray-500 text-xs">
            请审核上述需求文档 V2.0 和批判分析结果。
            <span className="text-purple-400">确认通过</span>后系统将自动生成
            spec.md / task.md / checklist.md 并创建 Git 仓库；
            <span className="text-amber-400">返回修改</span>将重新执行架构批判与需求迭代流程。
          </p>
        </div>

        {/* ============================================================ */}
        {/* 操作按钮 */}
        {/* ============================================================ */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-purple-500/20">
          {/* 驳回原因输入 */}
          <div className="flex-1 mr-4">
            {showRejectInput && (
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="请输入驳回原因（必填）"
                className="w-full px-3 py-2 bg-[#0f0f1a] border border-amber-500/30 rounded-lg text-gray-300 text-sm placeholder-gray-600 focus:outline-none focus:border-amber-500/60"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleReject();
                }}
              />
            )}
          </div>

          <div className="flex gap-3 flex-shrink-0">
            {/* 返回修改按钮 */}
            <button
              onClick={handleReject}
              disabled={showRejectInput && !rejectReason.trim()}
              className={[
                'px-5 py-2 rounded-lg text-sm font-medium transition-all',
                'bg-amber-500/10 border border-amber-500/30 text-amber-400',
                'hover:bg-amber-500/20 hover:border-amber-500/50',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              ].join(' ')}
            >
              {showRejectInput ? '确认返回修改' : '返回修改'}
            </button>

            {/* 确认按钮 - v1.3.0 增强：提升视觉对比度 + 加 disabled 状态反映 isConfirming */}
            <button
              onClick={handleConfirm}
              disabled={isConfirming}
              className={[
                'px-6 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer',
                'bg-purple-500/40 border border-purple-400/60 text-white shadow-md shadow-purple-500/20',
                'hover:bg-purple-500/60 hover:border-purple-300 hover:shadow-purple-500/40',
                'active:scale-95',
                'disabled:opacity-60 disabled:cursor-wait',
              ].join(' ')}
            >
              {isConfirming ? '确认中...' : '✓ 确认通过'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
