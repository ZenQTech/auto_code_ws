/**
 * # ============================================================
 * # 评审报告展示组件 - ReviewReport
 * # ============================================================
 * # 核心作用：展示 Loop Engineering 工作流中评估器返回的结构化评审报告，
 * #           包括总评分、维度评分柱状图、缺陷列表、通过/失败判定和总结文本。
 * # 运行流程：
 * #   1. 接收 reviewData prop，若无数据渲染空状态占位
 * #   2. 渲染顶部状态栏：总评分（颜色编码：绿≥80 / 黄≥60 / 红<60）+ 通过/失败图标
 * #   3. 渲染维度评分区：每个维度一条进度条，含维度名称、分数、颜色编码
 * #   4. 渲染缺陷列表：可折叠表格，每行含严重程度彩色徽章、位置、描述、修复建议
 * #   5. 渲染底部总结文本
 * # 输入参数：
 * #   - reviewData: ReviewData | null，评审数据，为 null 时显示空状态
 * # 输出结果：深色主题兼容的评审报告卡片 DOM
 * # 修改记录：
 * #   - 2026-07-22 | v1.0.0 | 初始版本，创建评审报告展示组件
 * # ============================================================
 */

import React, { useState } from 'react';
import type { ReviewData } from '../types';

/**
 * ReviewReport 组件 Props
 */
interface ReviewReportProps {
  /** 评审数据，null 时显示空状态 */
  reviewData: ReviewData | null;
}

/** 维度名称中文映射 */
const DIMENSION_LABELS: Record<string, string> = {
  correctness: '正确性',
  security: '安全性',
  standards: '规范性',
  completeness: '完整性',
};

/** 严重程度显示配置 */
const SEVERITY_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  critical: { label: '致命', bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/40' },
  major: { label: '严重', bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/40' },
  minor: { label: '轻微', bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/40' },
};

/**
 * 根据分数返回颜色样式
 * 参数：score - 0-100 的分数
 * 返回值：Tailwind 颜色类名的对象 { text, bg, bar }
 */
function getScoreColor(score: number): { text: string; bg: string; bar: string } {
  if (score >= 80) return { text: 'text-emerald-400', bg: 'bg-emerald-500/10', bar: 'bg-emerald-500' };
  if (score >= 60) return { text: 'text-amber-400', bg: 'bg-amber-500/10', bar: 'bg-amber-500' };
  return { text: 'text-red-400', bg: 'bg-red-500/10', bar: 'bg-red-500' };
}

/**
 * 评审报告展示组件
 * 核心逻辑：
 *   - 空数据时渲染空状态提示
 *   - 总评分颜色编码：≥80 绿色 / ≥60 黄色 / <60 红色
 *   - 维度评分进度条使用对应的颜色编码
 *   - 缺陷列表可折叠展开，默认折叠
 *   - 通过/失败判定使用大图标 + 文字
 */
export default function ReviewReport({ reviewData }: ReviewReportProps) {
  /** 缺陷列表是否展开 */
  const [defectsExpanded, setDefectsExpanded] = useState(false);

  // ============================================================
  // 空状态：无评审数据
  // ============================================================
  if (!reviewData) {
    return (
      <div className="rounded-2xl border border-surface-400/50 bg-surface-100 p-6">
        <div className="empty-state">
          <div className="empty-icon">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-surface-600">暂无评审报告</p>
          <p className="text-xs text-surface-500">等待评估器返回评审结果...</p>
        </div>
      </div>
    );
  }

  const scoreColor = getScoreColor(reviewData.overall_score);

  return (
    <div className="rounded-2xl border border-surface-400/50 bg-surface-100 overflow-hidden animate-scale-in">
      {/* ============================================================ */}
      {/* 顶部：总评分 + 通过/失败判定 */}
      {/* ============================================================ */}
      <div className="px-5 py-4 border-b border-surface-300/50">
        <div className="flex items-center justify-between">
          {/* 左侧：总评分 */}
          <div className="flex items-center gap-3">
            <div className={`w-14 h-14 rounded-xl ${scoreColor.bg} flex items-center justify-center`}>
              <span className={`text-xl font-bold ${scoreColor.text}`}>
                {reviewData.overall_score}
              </span>
            </div>
            <div>
              <div className="text-sm font-medium text-surface-800">评审总评分</div>
              <div className={`text-xs ${scoreColor.text}`}>
                {reviewData.overall_score >= 80 ? '优秀' : reviewData.overall_score >= 60 ? '一般' : '需改进'}
              </div>
            </div>
          </div>
          {/* 右侧：通过/失败判定 */}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium
            ${reviewData.passed
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              : 'bg-red-500/10 text-red-400 border border-red-500/30'
            }`}
          >
            {reviewData.passed ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            <span>{reviewData.passed ? '评审通过' : '评审未通过'}</span>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* 维度评分区 */}
      {/* ============================================================ */}
      <div className="px-5 py-4 border-b border-surface-300/50">
        <h3 className="text-xs font-medium text-surface-600 uppercase tracking-wider mb-3">
          维度评分
        </h3>
        <div className="space-y-3">
          {Object.entries(reviewData.dimension_scores).map(([dimension, score]) => {
            const dimColor = getScoreColor(score);
            const label = DIMENSION_LABELS[dimension] || dimension;
            return (
              <div key={dimension}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-surface-700">{label}</span>
                  <span className={`text-sm font-medium ${dimColor.text}`}>{score}/100</span>
                </div>
                <div className="w-full h-2 bg-surface-300 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${dimColor.bar}`}
                    style={{ width: `${Math.min(score, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ============================================================ */}
      {/* 缺陷列表（可折叠） */}
      {/* ============================================================ */}
      {reviewData.defects.length > 0 && (
        <div className="border-b border-surface-300/50">
          <button
            onClick={() => setDefectsExpanded(prev => !prev)}
            className="w-full flex items-center justify-between px-5 py-3 text-left
                       hover:bg-surface-200/50 transition-colors duration-150"
          >
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              <span className="text-sm font-medium text-surface-700">
                缺陷列表 ({reviewData.defects.length})
              </span>
            </div>
            <svg
              className={`w-4 h-4 text-surface-500 transition-transform duration-200 ${defectsExpanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* 缺陷列表内容 */}
          <div
            className={`overflow-hidden transition-all duration-300 ease-expressive ${
              defectsExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
            }`}
          >
            <div className="px-5 pb-4 space-y-2 max-h-[400px] overflow-y-auto">
              {/* 表头 */}
              <div className="grid grid-cols-[60px_1fr] gap-2 text-xs text-surface-500 font-medium px-2 py-1">
                <span>严重程度</span>
                <span>详情</span>
              </div>
              {/* 缺陷行 */}
              {reviewData.defects.map((defect) => {
                const sev = SEVERITY_CONFIG[defect.severity] || SEVERITY_CONFIG.minor;
                return (
                  <div
                    key={defect.defect_id}
                    className={`grid grid-cols-[60px_1fr] gap-2 px-3 py-2.5 rounded-lg border ${sev.border} ${sev.bg}`}
                  >
                    {/* 严重程度徽章 */}
                    <div className="flex items-start pt-0.5">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${sev.text} ${sev.bg}`}>
                        {sev.label}
                      </span>
                    </div>
                    {/* 缺陷详情 */}
                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-surface-500 text-[10px] uppercase tracking-wider">
                          [{defect.dimension}]
                        </span>
                        <span className="text-surface-400 font-mono text-[10px]">{defect.location}</span>
                      </div>
                      <p className="text-surface-700 leading-relaxed">{defect.description}</p>
                      <div className="flex items-start gap-1">
                        <span className="text-surface-500 flex-shrink-0">💡</span>
                        <p className="text-surface-600 italic">{defect.repair_plan}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* 底部：总结文本 */}
      {/* ============================================================ */}
      {reviewData.summary && (
        <div className="px-5 py-4">
          <h3 className="text-xs font-medium text-surface-600 uppercase tracking-wider mb-2">
            评审总结
          </h3>
          <div className="text-sm text-surface-700 leading-relaxed whitespace-pre-wrap">
            {reviewData.summary}
          </div>
        </div>
      )}
    </div>
  );
}