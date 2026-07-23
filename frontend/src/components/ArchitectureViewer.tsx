/**
 * # ============================================================
 * # ArchitectureViewer 架构设计查看器组件
 * # ============================================================
 * # 核心作用：展示架构设计文档（Markdown 渲染）、审查缺陷列表、
 * #           迭代状态、人工审核确认/拒绝按钮
 * # 运行流程：
 * #   1. 组件挂载时并行拉取架构状态、设计文档、审查结果
 * #   2. 渲染 Markdown 格式的架构设计文档
 * #   3. 渲染审查缺陷列表（带严重程度徽章）
 * #   4. 显示迭代状态（当前/最大）
 * #   5. 提供"确认"和"拒绝"按钮用于人工审核
 * # 输入参数：
 * #   - onConfirm?: () => void，确认审核的回调
 * #   - onReject?: () => void，拒绝审核的回调
 * # 输出结果：架构设计查看器 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现架构设计查看器
 * #   - 2026-06-25 | v1.1.0 | renderMarkdown / severityColorMap 提取到 ../utils/ 共享
 * # ============================================================
 */

import { useMemo } from 'react';
import { useArchitectureStatus, useArchitectureDesign, useArchitectureCritique } from '../hooks/useApi';
import { renderMarkdown } from '../utils/markdown';
import { severityColorMap } from '../utils/severity';

interface Props {
  /** 确认审核的回调 */
  onConfirm?: () => void;
  /** 拒绝审核的回调 */
  onReject?: () => void;
}

export default function ArchitectureViewer({ onConfirm, onReject }: Props) {
  /** 架构设计工作流状态 */
  const { status, loading: statusLoading } = useArchitectureStatus();
  /** 架构设计文档 */
  const { design, loading: designLoading } = useArchitectureDesign();
  /** 架构审查结果 */
  const { critique, loading: critiqueLoading } = useArchitectureCritique();

  /** 使用 useMemo 缓存 Markdown 渲染结果，仅在 design.content 变化时重新渲染 */
  const htmlContent = useMemo(
    () => renderMarkdown(design?.content || ''),
    [design?.content]
  );

  const isLoading = statusLoading || designLoading || critiqueLoading;

  // ============================================================
  // 加载态
  // ============================================================
  if (isLoading && !design && !status) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="skeleton h-6 w-40 rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton h-4 rounded" style={{ width: `${80 - i * 10}%` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[70vh]">
      {/* ============================================================
       * 标题栏：图标 + 标题 + 迭代状态
       * ============================================================ */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-surface-300">
        <div className="flex items-center gap-3">
          {/* 架构图标 */}
          <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zm12 0a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">架构设计</h3>
          {/* 设计文档版本号 */}
          {design?.version && (
            <span className="text-xs text-surface-500 bg-surface-200 px-2 py-0.5 rounded">
              v{design.version}
            </span>
          )}
        </div>

        {/* 迭代状态指示器 */}
        {status && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-surface-500">迭代</span>
            <span className="text-sm font-semibold text-hermes-400">
              {status.current_iteration}
            </span>
            <span className="text-xs text-surface-500">/ {status.max_iterations}</span>
            {/* 迭代进度小圆点 */}
            <div className="flex items-center gap-1 ml-1">
              {Array.from({ length: status.max_iterations }, (_, i) => (
                <span
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full ${
                    i < status.current_iteration ? 'bg-hermes-400' : 'bg-surface-400'
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================
       * 主内容区：左侧设计文档 + 右侧审查缺陷
       * ============================================================ */}
      <div className="flex-1 overflow-hidden flex gap-4 min-h-0">
        {/* 左侧：架构设计文档（Markdown 渲染） */}
        <div className="flex-1 overflow-y-auto pr-2">
          {design?.content ? (
            <div
              className="prose-sm max-w-none"
              dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
          ) : (
            <div className="empty-state">
              <span className="empty-icon">📐</span>
              <span>暂无架构设计文档</span>
            </div>
          )}
        </div>

        {/* 右侧：审查缺陷列表 */}
        <div className="w-72 flex-shrink-0 border-l border-surface-300 pl-4 overflow-y-auto">
          <h4 className="text-sm font-semibold text-surface-800 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            审查缺陷
            {/* 缺陷数量徽章 */}
            {critique?.defects && critique.defects.length > 0 && (
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                critique.passed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {critique.defects.length}
              </span>
            )}
          </h4>

          {critique?.defects && critique.defects.length > 0 ? (
            <div className="space-y-3">
              {critique.defects.map((defect) => {
                const sevStyle = severityColorMap[defect.severity];
                return (
                  <div
                    key={defect.id}
                    className="bg-surface-100/50 rounded-lg p-3 border border-surface-300"
                  >
                    {/* 缺陷标题 + 严重程度徽章 */}
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-sm font-medium text-surface-900 leading-tight">
                        {defect.title}
                      </span>
                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${sevStyle.bg} ${sevStyle.text}`}>
                        {sevStyle.label}
                      </span>
                    </div>
                    {/* 缺陷描述 */}
                    <p className="text-xs text-surface-600 mb-2">{defect.description}</p>
                    {/* 所在章节 + 修复建议 */}
                    <div className="text-xs text-surface-500 space-y-1">
                      <div>章节：{defect.section}</div>
                      <div className="text-hermes-400">建议：{defect.suggestion}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-xs text-surface-500 text-center py-4">
              {critique?.passed ? '✅ 审查通过，无缺陷' : '暂无审查结果'}
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
       * 底部操作栏：确认 / 拒绝按钮（仅需人工审核时显示）
       * ============================================================ */}
      {status?.needs_human_review && (
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-surface-300">
          {/* 审核提示 */}
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-sm text-surface-700">
              等待人工审核：<span className="text-hermes-400 font-medium">{status.review_node}</span>
            </span>
          </div>
          {/* 操作按钮 */}
          <div className="flex items-center gap-2">
            <button
              onClick={onReject}
              className="btn-ghost text-red-400 hover:text-red-300 hover:border-red-500/30"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              拒绝
            </button>
            <button
              onClick={onConfirm}
              className="btn-primary"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              确认通过
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
